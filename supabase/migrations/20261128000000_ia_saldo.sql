-- Synqalia · Configuración › IA y saldo (28/11/2026)
-- Saldo Synqalia por empresa, límites por persona, consumo de IA, recargas, avisos y precios por modelo.
-- PostgreSQL estándar (sin funciones exclusivas de Supabase). La web NO lee estas tablas: todo pasa por las funciones
-- «ia-saldo», «ai» y «asistente», que filtran siempre por company_id (además de RLS: sin políticas para anon/authenticated).
-- Importes en euros con 6 decimales (numeric). El formato que ve cada rol (%, €, créditos) lo decide la aplicación.
-- Auditoría: los triggers escriben en audit_log cada cambio de límites, niveles, saldo del plan y recargas (antes/después y quién).

-- 1. Empresa de cada miembro (multiempresa). Hoy todos son de Provalliance.
alter table public.members add column if not exists company_id text not null default 'provalliance';
create index if not exists members_company_idx on public.members (company_id);

-- 2. Configuración de IA por empresa
create table if not exists public.ia_empresas (
  company_id          text primary key,
  nombre              text not null,
  saldo_mensual       numeric(12,2) not null default 0,      -- € incluidos cada mes en el plan (lo fija el propietario de Synqalia)
  limite_mensual      numeric(12,2),                         -- tope de gasto al mes que pone el administrador (null = sin tope)
  limite_persona      numeric(12,2),                         -- € por persona y mes por defecto (null = sin límite propio)
  aviso_80            boolean not null default true,
  aviso_100           boolean not null default true,
  aviso_correo_admin  boolean not null default true,
  al_tope             text not null default 'pausar' check (al_tope in ('pausar','tarjeta')),
  tope_tarjeta        numeric(12,2),                         -- máximo de recargas con tarjeta por mes si al_tope = 'tarjeta'
  multiplicador       numeric(6,3),                          -- precio de venta = coste € × multiplicador (null = el de la plataforma)
  zona                text not null default 'Europe/Madrid', -- para cortar los meses
  activa              boolean not null default true,
  stripe_customer     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  updated_by          text
);

-- 3. Nivel y límite de cada persona
create table if not exists public.ia_personas (
  company_id  text not null references public.ia_empresas(company_id) on delete cascade,
  email       text not null,
  nivel       text not null default 'basica' check (nivel in ('basica','avanzada')),
  limite      numeric(12,2),                                 -- € al mes (null = el de la empresa)
  pide_avanzada timestamptz,                                 -- la persona ha pedido IA avanzada
  updated_at  timestamptz not null default now(),
  updated_by  text,
  primary key (company_id, email)
);

-- 4. Precios por modelo (USD por millón de tokens) y nivel al que pertenece
create table if not exists public.ia_modelos (
  modelo           text primary key,
  nivel            text not null check (nivel in ('basica','avanzada')),
  usd_in           numeric(10,4) not null,
  usd_out          numeric(10,4) not null,
  usd_cache_write  numeric(10,4) not null default 0,
  usd_cache_read   numeric(10,4) not null default 0,
  activo           boolean not null default true,
  updated_at       timestamptz not null default now()
);

-- 5. Ajustes de la plataforma (una sola fila; solo el propietario de Synqalia)
create table if not exists public.ia_plataforma (
  id                     int primary key default 1 check (id = 1),
  proveedor              text not null default 'anthropic' check (proveedor in ('anthropic','bedrock')),
  modelo_basica          text not null default 'claude-sonnet-5-5',
  modelo_avanzada        text not null default 'claude-opus-5-5',
  usd_eur                numeric(10,6) not null default 0.91,  -- € por cada US$
  multiplicador          numeric(6,3) not null default 2.5,
  aviso_saldo_usd        numeric(10,2) not null default 100,
  gasto_disparado_pct    int not null default 150,
  margen_min_pct         int not null default 60,
  anthropic_saldo_usd    numeric(12,2),                      -- lo que Jaime apunta tras recargar en la consola
  anthropic_saldo_fecha  timestamptz,
  anthropic_recarga_auto boolean not null default false,
  updated_at             timestamptz not null default now(),
  updated_by             text
);

-- 6. Consumo: una fila por llamada al modelo
create table if not exists public.ia_consumo (
  id            bigint generated always as identity primary key,
  company_id    text not null,
  owner         uuid,
  email         text not null,
  funcion       text not null,
  modelo        text not null,
  nivel         text not null default 'basica',
  tokens_in     int not null default 0,
  tokens_out    int not null default 0,
  tokens_cache_w int not null default 0,
  tokens_cache_r int not null default 0,
  coste_usd     numeric(14,6) not null default 0,
  coste_eur     numeric(14,6) not null default 0,
  importe       numeric(14,6) not null default 0,   -- lo que se descuenta del saldo Synqalia (€)
  ok            boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists ia_consumo_company_idx on public.ia_consumo (company_id, created_at desc);
create index if not exists ia_consumo_persona_idx on public.ia_consumo (company_id, email, created_at desc);

-- 7. Recargas y solicitudes de saldo (las recargas no caducan: se gastan cuando se acaba el saldo del mes)
create table if not exists public.ia_recargas (
  id              uuid primary key default gen_random_uuid(),
  company_id      text not null references public.ia_empresas(company_id) on delete cascade,
  tipo            text not null check (tipo in ('tarjeta','solicitud','ajuste')),
  importe         numeric(12,2) not null check (importe > 0),
  estado          text not null default 'pendiente' check (estado in ('pendiente','pagada','aprobada','rechazada','cancelada')),
  solicitado_por  text,
  resuelto_por    text,
  nota            text,
  stripe_session  text unique,
  created_at      timestamptz not null default now(),
  resuelto_at     timestamptz
);
create index if not exists ia_recargas_company_idx on public.ia_recargas (company_id, created_at desc);

-- 8. Avisos de 80 % y 100 % ya lanzados (uno por empresa/persona, mes y umbral)
create table if not exists public.ia_avisos (
  company_id  text not null,
  email       text not null default '',          -- '' = aviso de la empresa
  periodo     text not null,                     -- YYYY-MM
  umbral      int not null check (umbral in (80, 100)),
  created_at  timestamptz not null default now(),
  primary key (company_id, email, periodo, umbral)
);

-- RLS: activado y sin políticas para anon/authenticated. Solo el backend (rol de servicio) lee y escribe,
-- y filtra por company_id en cada consulta.
do $$
declare t text;
begin
  foreach t in array array['ia_empresas','ia_personas','ia_modelos','ia_plataforma','ia_consumo','ia_recargas','ia_avisos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Mes en curso (inicio) en la zona de la empresa
create or replace function public.ia_inicio_mes(p_zona text, p_ahora timestamptz default now())
returns timestamptz language sql stable as $$
  select (date_trunc('month', p_ahora at time zone p_zona)) at time zone p_zona
$$;

-- Estado del saldo de una empresa: saldo del mes, consumido, recargas disponibles y total disponible.
-- Las recargas aprobadas/pagadas se acumulan; cada mes se gasta primero el saldo del plan y luego las recargas.
create or replace function public.ia_saldo_empresa(p_company text)
returns table (saldo_mensual numeric, consumido_mes numeric, recargas_restantes numeric, disponible numeric, inicio_mes timestamptz)
language sql stable as $$
  with e as (select * from public.ia_empresas where company_id = p_company),
  ini as (select public.ia_inicio_mes(e.zona) as d from e),
  meses as (
    select date_trunc('month', c.created_at at time zone e.zona) as mes, sum(c.importe) as gasto
    from public.ia_consumo c, e where c.company_id = p_company group by 1
  ),
  rec as (select coalesce(sum(importe),0) as total from public.ia_recargas where company_id = p_company and estado in ('pagada','aprobada')),
  usado_rec as (
    -- recargas gastadas en meses anteriores (lo que pasó del saldo del plan)
    select coalesce(sum(greatest(m.gasto - e.saldo_mensual, 0)),0) as total
    from meses m, e, ini where m.mes < date_trunc('month', ini.d at time zone e.zona)
  ),
  mes_act as (select coalesce(sum(c.importe),0) as gasto from public.ia_consumo c, ini where c.company_id = p_company and c.created_at >= ini.d)
  select e.saldo_mensual,
         mes_act.gasto,
         greatest(rec.total - usado_rec.total - greatest(mes_act.gasto - e.saldo_mensual, 0), 0),
         greatest(e.saldo_mensual - mes_act.gasto, 0) + greatest(rec.total - usado_rec.total - greatest(mes_act.gasto - e.saldo_mensual, 0), 0),
         ini.d
  from e, ini, rec, usado_rec, mes_act
$$;
revoke all on function public.ia_saldo_empresa(text) from anon, authenticated, public;

-- Consumo agregado por empresa, persona y función desde una fecha (p_company null = todas). Para las pantallas.
create or replace function public.ia_agregado(p_company text, p_desde timestamptz, p_hasta timestamptz default null)
returns table (company_id text, email text, funcion text, usos bigint, importe numeric, coste_eur numeric, coste_usd numeric)
language sql stable as $$
  select c.company_id, c.email, c.funcion, count(*), sum(c.importe), sum(c.coste_eur), sum(c.coste_usd)
  from public.ia_consumo c
  where (p_company is null or c.company_id = p_company) and c.created_at >= p_desde and (p_hasta is null or c.created_at < p_hasta)
  group by 1, 2, 3
$$;
revoke all on function public.ia_agregado(text, timestamptz, timestamptz) from anon, authenticated, public;

-- Coste y facturación por mes (últimos meses), para el panel del propietario
create or replace function public.ia_meses(p_desde timestamptz)
returns table (mes text, importe numeric, coste_eur numeric, coste_usd numeric, usos bigint)
language sql stable as $$
  select to_char(date_trunc('month', created_at at time zone 'Europe/Madrid'), 'YYYY-MM'), sum(importe), sum(coste_eur), sum(coste_usd), count(*)
  from public.ia_consumo where created_at >= p_desde group by 1 order by 1
$$;
revoke all on function public.ia_meses(timestamptz) from anon, authenticated, public;
revoke all on function public.ia_inicio_mes(text, timestamptz) from anon, authenticated, public;

-- Las funciones solo las ejecuta el backend (rol de servicio en Supabase; en AWS, el rol de la aplicación)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.ia_saldo_empresa(text), public.ia_inicio_mes(text, timestamptz),
      public.ia_agregado(text, timestamptz, timestamptz), public.ia_meses(timestamptz) to service_role;
  end if;
end $$;

-- Auditoría automática de cambios de saldo, límites, niveles y recargas
create or replace function public.ia_auditar() returns trigger language plpgsql as $$
declare
  v_company text;
  v_por text;
begin
  if tg_op = 'DELETE' then
    v_company := coalesce(to_jsonb(old)->>'company_id', 'plataforma');
    v_por := to_jsonb(old)->>'updated_by';
  else
    v_company := coalesce(to_jsonb(new)->>'company_id', 'plataforma');
    v_por := coalesce(to_jsonb(new)->>'updated_by', to_jsonb(new)->>'resuelto_por', to_jsonb(new)->>'solicitado_por');
  end if;
  insert into public.audit_log (company_id, owner, accion, detalle)
  values (v_company, null, 'ia.' || tg_table_name || '.' || lower(tg_op),
          jsonb_build_object('por', v_por,
                             'antes', case when tg_op <> 'INSERT' then to_jsonb(old) end,
                             'despues', case when tg_op <> 'DELETE' then to_jsonb(new) end));
  return coalesce(new, old);
end $$;

drop trigger if exists ia_empresas_audit on public.ia_empresas;
create trigger ia_empresas_audit after insert or update or delete on public.ia_empresas for each row execute function public.ia_auditar();
drop trigger if exists ia_personas_audit on public.ia_personas;
create trigger ia_personas_audit after insert or update or delete on public.ia_personas for each row execute function public.ia_auditar();
drop trigger if exists ia_recargas_audit on public.ia_recargas;
create trigger ia_recargas_audit after insert or update or delete on public.ia_recargas for each row execute function public.ia_auditar();
drop trigger if exists ia_plataforma_audit on public.ia_plataforma;
create trigger ia_plataforma_audit after insert or update on public.ia_plataforma for each row execute function public.ia_auditar();
drop trigger if exists ia_modelos_audit on public.ia_modelos;
create trigger ia_modelos_audit after insert or update or delete on public.ia_modelos for each row execute function public.ia_auditar();

-- Datos iniciales
-- Precios públicos de Anthropic (US$ por millón de tokens, nov. 2026). Se cambian aquí o desde el panel del propietario.
insert into public.ia_modelos (modelo, nivel, usd_in, usd_out, usd_cache_write, usd_cache_read) values
  ('claude-sonnet-5-5', 'basica',   2, 10, 2.5, 0.10),
  ('claude-opus-5-5',   'avanzada', 4, 20, 5,   0.20)
on conflict (modelo) do nothing;

insert into public.ia_plataforma (id, updated_by) values (1, 'migracion') on conflict (id) do nothing;

-- Provalliance (piloto): 300 € al mes de saldo Synqalia, sin límite por persona. Ajustable desde la pantalla.
insert into public.ia_empresas (company_id, nombre, saldo_mensual, updated_by)
values ('provalliance', 'Grupo Provalliance España', 300, 'migracion')
on conflict (company_id) do nothing;
