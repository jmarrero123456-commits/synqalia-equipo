-- Synqalia · Motor IA común (28/11/2026)
-- Una sola puerta para toda la IA: niveles (básica / avanzada / fondo), saldo mensual por empresa y por usuario,
-- recarga automática con tope, modo ahorro al agotarse y registro de cada llamada (tokens, modelo, coste, error).
--
-- PostgreSQL estándar (plpgsql), sin funciones exclusivas de Supabase: se migra tal cual a RDS.
-- Las tablas no tienen políticas para anon/authenticated: solo el backend (rol de servicio) lee y escribe,
-- y el backend filtra SIEMPRE por company_id (además de RLS).
--
-- Unidad de saldo: «crédito». 1 crédito = IA_CREDITO_EUR euros de coste real de IA (por defecto 0,01 €).
-- Así el precio que se cobra no depende del dólar ni de las tarifas del proveedor: si cambian, se cambia
-- el valor del crédito o la tabla ia_precios, no las tarifas a clientes.

-- 1) Empresa de cada miembro (paso hacia multiempresa; todos los actuales son de Provalliance).
alter table public.members add column if not exists company_id text not null default 'provalliance';
create index if not exists members_company_idx on public.members (company_id);

-- 2) Precios del proveedor (USD por millón de tokens). Datos, no código: se actualizan sin desplegar.
create table if not exists public.ia_precios (
  modelo               text primary key,
  entrada_usd          numeric(12,4) not null,
  salida_usd           numeric(12,4) not null,
  cache_escritura_usd  numeric(12,4) not null default 0,
  cache_lectura_usd    numeric(12,4) not null default 0,
  actualizado          date not null default current_date
);
insert into public.ia_precios (modelo, entrada_usd, salida_usd, cache_escritura_usd, cache_lectura_usd, actualizado) values
  ('claude-haiku-5-5',  0.10,  0.50,  0.125, 0.01, '2026-11-27'),
  ('claude-sonnet-5-5', 2.00, 10.00,  2.50,  0.10, '2026-11-27'),
  ('claude-opus-5-5',   4.00, 20.00,  5.00,  0.20, '2026-11-27')
on conflict (modelo) do nothing;

-- 3) Configuración de IA de cada empresa (la edita su administrador y el dueño de Synqalia).
create table if not exists public.ia_empresa (
  company_id                 text primary key,
  activa                     boolean not null default true,
  creditos_basica_usuario    numeric(12,2) not null default 400,   -- 4 € de coste/mes por usuario
  creditos_avanzada_usuario  numeric(12,2) not null default 800,   -- 8 € de coste/mes por usuario
  recarga_auto               boolean not null default false,
  recarga_creditos           numeric(12,2) not null default 400,   -- una recarga de 10 € = 4 € de coste
  recarga_umbral_pct         integer not null default 10 check (recarga_umbral_pct between 1 and 50),
  recarga_max_mes            integer not null default 3 check (recarga_max_mes between 0 and 50),
  al_agotar                  text not null default 'ahorro' check (al_agotar in ('ahorro', 'parar')),
  updated_at                 timestamptz not null default now()
);
insert into public.ia_empresa (company_id) values ('provalliance') on conflict do nothing;

-- 4) Nivel y límites de cada usuario.
create table if not exists public.ia_usuario (
  company_id       text not null,
  email            text not null,
  nivel            text not null default 'basica' check (nivel in ('basica', 'avanzada')),
  limite_creditos  numeric(12,2),            -- null = el del nivel
  bloqueado        boolean not null default false,
  updated_at       timestamptz not null default now(),
  primary key (company_id, email)
);

-- 5) Saldo de la empresa por mes (periodo = 'YYYY-MM').
create table if not exists public.ia_periodo (
  company_id         text not null,
  periodo            text not null check (periodo ~ '^\d{4}-\d{2}$'),
  creditos_incluidos numeric(14,2) not null default 0,
  creditos_extra     numeric(14,2) not null default 0,
  creditos_usados    numeric(14,4) not null default 0,
  recargas           integer not null default 0,
  updated_at         timestamptz not null default now(),
  primary key (company_id, periodo)
);

-- 6) Consumo de cada usuario por mes (para su límite personal).
create table if not exists public.ia_uso_usuario (
  company_id       text not null,
  email            text not null,
  periodo          text not null,
  creditos_usados  numeric(14,4) not null default 0,
  consultas        integer not null default 0,
  primary key (company_id, email, periodo)
);

-- 7) Registro de cada llamada al modelo (también las fallidas, con su motivo).
create table if not exists public.ia_consumo (
  id                      bigint generated always as identity primary key,
  company_id              text not null,
  email                   text not null,
  funcion                 text not null,
  nivel                   text not null check (nivel in ('basica', 'avanzada', 'fondo', 'ahorro')),
  modelo                  text not null,
  tokens_entrada          integer not null default 0,
  tokens_salida           integer not null default 0,
  tokens_cache_lectura    integer not null default 0,
  tokens_cache_escritura  integer not null default 0,
  coste_usd               numeric(12,6) not null default 0,
  creditos                numeric(12,4) not null default 0,
  ok                      boolean not null default true,
  codigo_error            text,
  ms                      integer,
  created_at              timestamptz not null default now()
);
create index if not exists ia_consumo_company_idx on public.ia_consumo (company_id, created_at desc);
create index if not exists ia_consumo_usuario_idx on public.ia_consumo (company_id, email, created_at desc);

-- 8) Recargas (automáticas o compradas). El cobro se hace aparte (Stripe o factura): aquí queda pendiente.
create table if not exists public.ia_recargas (
  id          bigint generated always as identity primary key,
  company_id  text not null,
  periodo     text not null,
  creditos    numeric(12,2) not null,
  origen      text not null check (origen in ('auto', 'compra', 'manual')),
  cobro       text not null default 'pendiente' check (cobro in ('pendiente', 'cobrado', 'incluido', 'anulado')),
  created_at  timestamptz not null default now()
);
create index if not exists ia_recargas_company_idx on public.ia_recargas (company_id, created_at desc);

-- RLS activado y sin políticas: nadie desde la web; solo el backend.
alter table public.ia_precios     enable row level security;
alter table public.ia_empresa     enable row level security;
alter table public.ia_usuario     enable row level security;
alter table public.ia_periodo     enable row level security;
alter table public.ia_uso_usuario enable row level security;
alter table public.ia_consumo     enable row level security;
alter table public.ia_recargas    enable row level security;
revoke all on public.ia_precios, public.ia_empresa, public.ia_usuario, public.ia_periodo,
              public.ia_uso_usuario, public.ia_consumo, public.ia_recargas from anon, authenticated;

-- Saldo incluido de una empresa en un mes = suma de lo que da el nivel de cada miembro.
create or replace function public.ia_incluidos(p_company text) returns numeric
language sql stable set search_path = public as $$
  select coalesce(sum(case when coalesce(u.nivel, 'basica') = 'avanzada' then e.creditos_avanzada_usuario
                           else e.creditos_basica_usuario end), 0)
  from members m
  join ia_empresa e on e.company_id = m.company_id
  left join ia_usuario u on u.company_id = m.company_id and u.email = lower(m.email)
  where m.company_id = p_company
$$;

-- Estado de IA de un usuario: lo consulta el motor antes de cada llamada y la app para el indicador de saldo.
create or replace function public.ia_estado(p_company text, p_email text, p_periodo text) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_email text := lower(p_email);
  e   ia_empresa;
  u   ia_usuario;
  p   ia_periodo;
  uu  ia_uso_usuario;
  v_limite numeric;
begin
  select * into e from ia_empresa where company_id = p_company;
  if not found then
    insert into ia_empresa (company_id) values (p_company) on conflict do nothing;
    select * into e from ia_empresa where company_id = p_company;
  end if;
  insert into ia_periodo (company_id, periodo, creditos_incluidos)
    values (p_company, p_periodo, ia_incluidos(p_company))
    on conflict (company_id, periodo) do nothing;
  select * into p from ia_periodo where company_id = p_company and periodo = p_periodo;
  select * into u from ia_usuario where company_id = p_company and email = v_email;
  select * into uu from ia_uso_usuario where company_id = p_company and email = v_email and periodo = p_periodo;
  v_limite := coalesce(u.limite_creditos,
                       case when coalesce(u.nivel, 'basica') = 'avanzada' then e.creditos_avanzada_usuario
                            else e.creditos_basica_usuario end);
  return jsonb_build_object(
    'activa',            e.activa,
    'nivel',             coalesce(u.nivel, 'basica'),
    'bloqueado',         coalesce(u.bloqueado, false),
    'al_agotar',         e.al_agotar,
    'usuario_limite',    v_limite,
    'usuario_usados',    coalesce(uu.creditos_usados, 0),
    'empresa_total',     p.creditos_incluidos + p.creditos_extra,
    'empresa_usados',    p.creditos_usados,
    'recarga_auto',      e.recarga_auto,
    'recargas',          p.recargas,
    'recarga_max_mes',   e.recarga_max_mes
  );
end $$;

-- Registra una llamada, descuenta el saldo y, si toca, hace la recarga automática. Todo en una transacción.
create or replace function public.ia_registrar(
  p_company text, p_email text, p_periodo text, p_funcion text, p_nivel text, p_modelo text,
  p_tokens_entrada integer, p_tokens_salida integer, p_cache_lectura integer, p_cache_escritura integer,
  p_coste_usd numeric, p_creditos numeric, p_ok boolean, p_codigo_error text, p_ms integer
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_email text := lower(p_email);
  e ia_empresa;
  p ia_periodo;
  v_recarga boolean := false;
begin
  insert into ia_consumo (company_id, email, funcion, nivel, modelo, tokens_entrada, tokens_salida,
                          tokens_cache_lectura, tokens_cache_escritura, coste_usd, creditos, ok, codigo_error, ms)
  values (p_company, v_email, left(p_funcion, 60), p_nivel, p_modelo, coalesce(p_tokens_entrada, 0), coalesce(p_tokens_salida, 0),
          coalesce(p_cache_lectura, 0), coalesce(p_cache_escritura, 0), coalesce(p_coste_usd, 0), coalesce(p_creditos, 0),
          p_ok, left(p_codigo_error, 60), p_ms);

  if coalesce(p_creditos, 0) > 0 then
    insert into ia_periodo (company_id, periodo, creditos_incluidos)
      values (p_company, p_periodo, ia_incluidos(p_company))
      on conflict (company_id, periodo) do nothing;
    update ia_periodo set creditos_usados = creditos_usados + p_creditos, updated_at = now()
      where company_id = p_company and periodo = p_periodo
      returning * into p;
    insert into ia_uso_usuario (company_id, email, periodo, creditos_usados, consultas)
      values (p_company, v_email, p_periodo, p_creditos, 1)
      on conflict (company_id, email, periodo)
      do update set creditos_usados = ia_uso_usuario.creditos_usados + excluded.creditos_usados,
                    consultas = ia_uso_usuario.consultas + 1;

    -- Recarga automática: queda menos del umbral, está activada y no se ha pasado del máximo del mes.
    select * into e from ia_empresa where company_id = p_company;
    if e.recarga_auto and p.recargas < e.recarga_max_mes
       and (p.creditos_incluidos + p.creditos_extra - p.creditos_usados)
           < (p.creditos_incluidos + p.creditos_extra) * e.recarga_umbral_pct / 100.0 then
      update ia_periodo set creditos_extra = creditos_extra + e.recarga_creditos, recargas = recargas + 1, updated_at = now()
        where company_id = p_company and periodo = p_periodo;
      insert into ia_recargas (company_id, periodo, creditos, origen) values (p_company, p_periodo, e.recarga_creditos, 'auto');
      insert into audit_log (company_id, owner, accion, detalle)
        values (p_company, null, 'ia.recarga_auto', jsonb_build_object('periodo', p_periodo, 'creditos', e.recarga_creditos, 'por', v_email));
      v_recarga := true;
    end if;
  end if;
  return jsonb_build_object('recarga', v_recarga);
end $$;

revoke execute on function public.ia_incluidos(text) from public, anon, authenticated;
revoke execute on function public.ia_estado(text, text, text) from public, anon, authenticated;
revoke execute on function public.ia_registrar(text, text, text, text, text, text, integer, integer, integer, integer, numeric, numeric, boolean, text, integer)
  from public, anon, authenticated;
