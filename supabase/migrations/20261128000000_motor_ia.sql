-- Synqalia · Motor IA común (28/11/2026)
-- Una sola puerta para toda la IA: comprueba saldo/límites, apunta el consumo de cada petición y lo descuenta.
--
-- Reglas de negocio (validadas por Jaime):
--   · El saldo de cada empresa es la bolsa mensual de su plan (se renueva el día 1, hora de Madrid) + saldo extra comprado.
--   · El saldo descuenta el coste real × multiplicador del plan (hoy 1: coste real). Se guardan las dos cifras para el margen.
--   · Al 100 % (o al límite que fije el administrador de la empresa, o al límite por usuario) se bloquea el nivel AVANZADO:
--     la petición se atiende con el nivel BÁSICO, que sigue funcionando. Solo el techo de seguridad del plan
--     (opcional) corta también el básico.
--   · Avisos al 80 % y al 100 %, una vez por mes, para los administradores de la empresa.
--
-- PostgreSQL estándar (sin funciones exclusivas de Supabase salvo, de forma opcional, auth.jwt() en app_usuario_actual,
-- que en otro servidor lee la variable de sesión app.user_email). Los permisos para los roles de Supabase
-- (anon, authenticated, service_role) se aplican solo si esos roles existen.

-- ============ Empresas y planes ============
create table if not exists public.ia_planes (
  id                 text primary key,
  nombre             text not null,
  bolsa_mensual_eur  numeric(12,4) not null default 0,     -- saldo de IA incluido cada mes
  avanzado           boolean not null default true,        -- el plan da acceso al nivel avanzado
  tope_seguridad_eur numeric(12,4),                        -- gasto máximo del mes (corta también el básico); null = sin techo
  multiplicador      numeric(8,4) not null default 1,      -- importe cobrado = coste real × multiplicador
  created_at         timestamptz not null default now()
);

create table if not exists public.empresas (
  id         text primary key,
  nombre     text not null,
  plan_id    text references public.ia_planes(id),
  activa     boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.ia_planes (id, nombre, bolsa_mensual_eur, avanzado, tope_seguridad_eur, multiplicador)
values ('interno', 'Interno (Provalliance)', 100, true, null, 1)
on conflict (id) do nothing;

insert into public.empresas (id, nombre, plan_id)
values ('provalliance', 'Grupo Provalliance España', 'interno')
on conflict (id) do nothing;

alter table public.members add column if not exists company_id text not null default 'provalliance' references public.empresas(id);
create index if not exists members_company_idx on public.members (company_id);

-- ============ Tarifas (coste del proveedor) ============
-- Una fila por familia de modelo («patron» se busca dentro del nombre del modelo: sirve igual para
-- «claude-sonnet-5-5» de Anthropic que para el id de Bedrock). proveedor null = vale para cualquiera;
-- una fila con proveedor concreto tiene preferencia (p. ej. recargo regional de Bedrock).
create table if not exists public.ia_tarifas (
  id                        bigint generated always as identity primary key,
  proveedor                 text,
  patron                    text not null,
  usd_entrada_mtok          numeric(12,6) not null,
  usd_salida_mtok           numeric(12,6) not null,
  usd_cache_lectura_mtok    numeric(12,6),
  usd_cache_escritura_mtok  numeric(12,6),
  umbral_largo_tokens       integer,               -- a partir de aquí se aplican los precios «largos»
  usd_entrada_largo_mtok    numeric(12,6),
  usd_salida_largo_mtok     numeric(12,6),
  eur_por_usd               numeric(10,6) not null,
  vigente_desde             timestamptz not null default now(),
  nota                      text
);
create index if not exists ia_tarifas_patron_idx on public.ia_tarifas (patron, vigente_desde desc);

-- Precios públicos de la API de Anthropic (nov 2026) y cambio aproximado 1 € = 1,12 $. Revisar y añadir filas nuevas
-- (con su fecha) cuando cambien: el histórico queda.
insert into public.ia_tarifas (proveedor, patron, usd_entrada_mtok, usd_salida_mtok, usd_cache_lectura_mtok, usd_cache_escritura_mtok, umbral_largo_tokens, usd_entrada_largo_mtok, usd_salida_largo_mtok, eur_por_usd, vigente_desde, nota)
select * from (values
  (null::text, 'sonnet-5-5', 2::numeric, 10::numeric, 0.10::numeric, 2.50::numeric, null::int, null::numeric, null::numeric, 0.89::numeric, '2026-11-01'::timestamptz, 'Precio API Anthropic'),
  (null, 'opus-5-5', 4, 20, 0.20, 5, null, null, null, 0.89, '2026-11-01', 'Precio API Anthropic'),
  (null, 'haiku-5-5', 0.10, 0.50, null, null, 100000, 0.50, 2.50, 0.89, '2026-11-01', 'Precio API Anthropic (más caro por encima de 100.000 tokens)')
) v
where not exists (select 1 from public.ia_tarifas);

-- ============ Saldo por empresa ============
create table if not exists public.ia_saldo (
  company_id          text primary key references public.empresas(id),
  periodo             date not null default date '1900-01-01',   -- mes en curso (día 1); al cambiar de mes se renueva la bolsa
  bolsa_restante_eur  numeric(14,6) not null default 0,
  extra_eur           numeric(14,6) not null default 0,          -- saldo comprado aparte (no caduca)
  exceso_mes_eur      numeric(14,6) not null default 0,          -- gasto del mes por encima de bolsa + extra (nivel básico)
  limite_mensual_eur  numeric(12,4),                             -- límite que fija el administrador de la empresa (opcional)
  limite_usuario_eur  numeric(12,4),                             -- límite mensual por persona (opcional)
  actualizado         timestamptz not null default now()
);
insert into public.ia_saldo (company_id) values ('provalliance') on conflict do nothing;

-- ============ Libro de movimientos del saldo ============
create table if not exists public.ia_movimientos (
  id          bigint generated always as identity primary key,
  company_id  text not null references public.empresas(id),
  tipo        text not null check (tipo in ('bolsa_mensual', 'recarga', 'ajuste')),
  importe_eur numeric(14,6) not null,
  motivo      text,
  hecho_por   text,
  created_at  timestamptz not null default now()
);
create index if not exists ia_movimientos_company_idx on public.ia_movimientos (company_id, created_at desc);

-- ============ Consumo: una fila por llamada al modelo ============
create table if not exists public.ia_consumo (
  id                     uuid primary key default gen_random_uuid(),
  company_id             text not null references public.empresas(id),
  usuario                text not null,                 -- email
  peticion_id            uuid,                          -- agrupa los pasos de una misma consulta del Asistente
  funcion                text not null,                 -- sugerida, resumen, perfeccionar, tareas, asistente, asistente_voz, chat, general…
  nivel_pedido           text not null check (nivel_pedido in ('basico', 'avanzado')),
  nivel                  text not null check (nivel in ('basico', 'avanzado')),
  motivo_nivel           text,                          -- por qué se bajó a básico: sin_saldo, limite_empresa, limite_usuario, plan
  proveedor              text not null,
  modelo                 text not null,
  tokens_entrada         integer not null default 0,
  tokens_salida          integer not null default 0,
  tokens_cache_lectura   integer not null default 0,
  tokens_cache_escritura integer not null default 0,
  importe_estimado_eur   numeric(14,6) not null default 0, -- reserva mientras está en curso
  coste_real_eur         numeric(14,6) not null default 0, -- lo que cuesta al proveedor
  importe_eur            numeric(14,6) not null default 0, -- lo que se descuenta a la empresa
  estado                 text not null default 'en_curso' check (estado in ('en_curso', 'ok', 'error', 'caducada')),
  codigo_error           text,
  duracion_ms            integer,
  created_at             timestamptz not null default now(),
  terminado              timestamptz
);
create index if not exists ia_consumo_company_idx on public.ia_consumo (company_id, created_at desc);
create index if not exists ia_consumo_usuario_idx on public.ia_consumo (company_id, usuario, created_at desc);
create index if not exists ia_consumo_en_curso_idx on public.ia_consumo (company_id) where estado = 'en_curso';

-- ============ Avisos 80 % / 100 % ============
create table if not exists public.ia_avisos (
  id            bigint generated always as identity primary key,
  company_id    text not null references public.empresas(id),
  periodo       date not null,
  umbral        integer not null check (umbral in (80, 100)),
  porcentaje    numeric(8,2) not null,
  destinatarios text[] not null default '{}',   -- administradores de la empresa
  leido_por     text[] not null default '{}',
  created_at    timestamptz not null default now(),
  unique (company_id, periodo, umbral)
);

-- ============ Quién es el usuario (portable) ============
-- Hoy: email del token de Supabase. En otro servidor: la aplicación hace SET app.user_email = '...' por conexión.
create or replace function public.app_usuario_actual() returns text
language plpgsql stable set search_path = public as $$
declare v text;
begin
  v := nullif(current_setting('app.user_email', true), '');
  if v is null then
    begin
      execute 'select auth.jwt() ->> ''email''' into v;
    exception when others then v := null;
    end;
  end if;
  return lower(v);
end $$;

create or replace function public.app_empresa_actual() returns text
language sql stable security definer set search_path = public as $$
  select company_id from public.members where lower(email) = public.app_usuario_actual() limit 1
$$;

create or replace function public.app_es_admin_empresa() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.members where lower(email) = public.app_usuario_actual() limit 1), false)
$$;

-- ============ RLS ============
alter table public.empresas       enable row level security;
alter table public.ia_planes      enable row level security;
alter table public.ia_tarifas     enable row level security;
alter table public.ia_saldo       enable row level security;
alter table public.ia_movimientos enable row level security;
alter table public.ia_consumo     enable row level security;
alter table public.ia_avisos      enable row level security;

drop policy if exists empresas_ver on public.empresas;
create policy empresas_ver on public.empresas for select using (id = (select public.app_empresa_actual()));
drop policy if exists ia_planes_ver on public.ia_planes;
create policy ia_planes_ver on public.ia_planes for select using (id in (select plan_id from public.empresas where id = (select public.app_empresa_actual())));
-- ia_tarifas: sin políticas (coste interno de Synqalia; solo el backend).
drop policy if exists ia_saldo_ver on public.ia_saldo;
create policy ia_saldo_ver on public.ia_saldo for select using (company_id = (select public.app_empresa_actual()));
drop policy if exists ia_movimientos_ver on public.ia_movimientos;
create policy ia_movimientos_ver on public.ia_movimientos for select using (company_id = (select public.app_empresa_actual()) and (select public.app_es_admin_empresa()));
drop policy if exists ia_consumo_ver on public.ia_consumo;
create policy ia_consumo_ver on public.ia_consumo for select using (
  company_id = (select public.app_empresa_actual())
  and (usuario = (select public.app_usuario_actual()) or (select public.app_es_admin_empresa()))
);
drop policy if exists ia_avisos_ver on public.ia_avisos;
create policy ia_avisos_ver on public.ia_avisos for select using (company_id = (select public.app_empresa_actual()) and (select public.app_es_admin_empresa()));

-- ============ Coste de una llamada (en €) ============
create or replace function public.ia_coste(p_proveedor text, p_modelo text, p_in integer, p_out integer, p_cache_r integer default 0, p_cache_w integer default 0)
returns numeric language plpgsql stable set search_path = public as $$
declare t public.ia_tarifas; v_largo boolean; v_in numeric; v_out numeric;
begin
  select * into t from public.ia_tarifas
   where position(patron in lower(p_modelo)) > 0 and (proveedor is null or proveedor = p_proveedor) and vigente_desde <= now()
   order by (proveedor is null), length(patron) desc, vigente_desde desc limit 1;
  if not found then return null; end if;
  v_largo := t.umbral_largo_tokens is not null and (coalesce(p_in,0) + coalesce(p_cache_r,0) + coalesce(p_cache_w,0)) > t.umbral_largo_tokens;
  v_in  := case when v_largo then coalesce(t.usd_entrada_largo_mtok, t.usd_entrada_mtok) else t.usd_entrada_mtok end;
  v_out := case when v_largo then coalesce(t.usd_salida_largo_mtok, t.usd_salida_mtok) else t.usd_salida_mtok end;
  return round((
      coalesce(p_in,0) * v_in + coalesce(p_out,0) * v_out
    + coalesce(p_cache_r,0) * coalesce(t.usd_cache_lectura_mtok, v_in * 0.1)
    + coalesce(p_cache_w,0) * coalesce(t.usd_cache_escritura_mtok, v_in * 1.25)
  ) / 1000000.0 * t.eur_por_usd, 6);
end $$;

-- Mes en curso (hora de Madrid) y renovación de la bolsa. Se llama con la fila de ia_saldo bloqueada.
create or replace function public.ia_mes_actual() returns date language sql stable as $$
  select date_trunc('month', now() at time zone 'Europe/Madrid')::date
$$;
create or replace function public.ia_inicio_mes() returns timestamptz language sql stable as $$
  select (date_trunc('month', now() at time zone 'Europe/Madrid')) at time zone 'Europe/Madrid'
$$;

create or replace function public.ia_renovar_mes(p_company text) returns void
language plpgsql set search_path = public as $$
declare v_mes date := public.ia_mes_actual(); v_bolsa numeric;
begin
  insert into public.ia_saldo (company_id) values (p_company) on conflict do nothing;
  select coalesce(p.bolsa_mensual_eur, 0) into v_bolsa from public.empresas e left join public.ia_planes p on p.id = e.plan_id where e.id = p_company;
  update public.ia_saldo set periodo = v_mes, bolsa_restante_eur = coalesce(v_bolsa, 0), exceso_mes_eur = 0, actualizado = now()
   where company_id = p_company and periodo < v_mes;
  if found then
    insert into public.ia_movimientos (company_id, tipo, importe_eur, motivo, hecho_por)
    values (p_company, 'bolsa_mensual', coalesce(v_bolsa, 0), 'Bolsa del plan para ' || to_char(v_mes, 'MM/YYYY'), 'sistema');
  end if;
end $$;

-- ============ 1) Reservar antes de llamar al modelo ============
-- Devuelve {ok, consumo_id, nivel, modelo, degradado, motivo} o {ok:false, codigo}.
create or replace function public.ia_reservar(
  p_company text, p_usuario text, p_funcion text, p_nivel text, p_peticion uuid,
  p_proveedor text, p_modelo_basico text, p_modelo_avanzado text,
  p_tokens_entrada integer, p_tokens_salida integer
) returns jsonb language plpgsql set search_path = public as $$
declare
  s public.ia_saldo; p public.ia_planes; e public.empresas;
  v_mult numeric; v_est_b numeric; v_est_a numeric; v_reservado numeric; v_mes_consumo numeric; v_usr_consumo numeric;
  v_disponible numeric; v_nivel text := case when p_nivel = 'avanzado' then 'avanzado' else 'basico' end; v_motivo text; v_modelo text; v_id uuid;
begin
  if not exists (select 1 from public.members where lower(email) = lower(p_usuario) and company_id = p_company) then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;
  select * into e from public.empresas where id = p_company;
  if not found or not e.activa then return jsonb_build_object('ok', false, 'codigo', 'no_autorizado'); end if;
  select * into p from public.ia_planes where id = e.plan_id;
  if not found then return jsonb_build_object('ok', false, 'codigo', 'sin_plan'); end if;
  v_mult := p.multiplicador;

  perform public.ia_renovar_mes(p_company);
  select * into s from public.ia_saldo where company_id = p_company for update;   -- serializa las reservas de la empresa

  -- reservas olvidadas (la función murió a medias): se sueltan a los 15 minutos
  update public.ia_consumo set estado = 'caducada', terminado = now()
   where company_id = p_company and estado = 'en_curso' and created_at < now() - interval '15 minutes';

  v_est_b := public.ia_coste(p_proveedor, p_modelo_basico, p_tokens_entrada, p_tokens_salida);
  v_est_a := public.ia_coste(p_proveedor, p_modelo_avanzado, p_tokens_entrada, p_tokens_salida);
  if v_est_b is null or (v_nivel = 'avanzado' and v_est_a is null) then
    return jsonb_build_object('ok', false, 'codigo', 'configuracion', 'detalle', 'Falta la tarifa del modelo en ia_tarifas');
  end if;
  v_est_b := v_est_b * v_mult; v_est_a := coalesce(v_est_a, 0) * v_mult;

  select coalesce(sum(importe_estimado_eur), 0) into v_reservado from public.ia_consumo where company_id = p_company and estado = 'en_curso';
  select coalesce(sum(importe_eur), 0) into v_mes_consumo from public.ia_consumo where company_id = p_company and created_at >= public.ia_inicio_mes() and estado <> 'en_curso';
  select coalesce(sum(importe_eur + case when estado = 'en_curso' then importe_estimado_eur else 0 end), 0) into v_usr_consumo
    from public.ia_consumo where company_id = p_company and usuario = lower(p_usuario) and created_at >= public.ia_inicio_mes();

  -- techo de seguridad del plan: corta todo, también el básico
  if p.tope_seguridad_eur is not null and v_mes_consumo + v_reservado + v_est_b > p.tope_seguridad_eur then
    return jsonb_build_object('ok', false, 'codigo', 'tope');
  end if;

  if v_nivel = 'avanzado' then
    v_disponible := s.bolsa_restante_eur + s.extra_eur - v_reservado;
    if not p.avanzado then v_nivel := 'basico'; v_motivo := 'plan';
    elsif s.limite_mensual_eur is not null and v_mes_consumo + v_reservado + v_est_a > s.limite_mensual_eur then v_nivel := 'basico'; v_motivo := 'limite_empresa';
    elsif v_disponible < v_est_a then v_nivel := 'basico'; v_motivo := 'sin_saldo';
    elsif s.limite_usuario_eur is not null and v_usr_consumo + v_est_a > s.limite_usuario_eur then v_nivel := 'basico'; v_motivo := 'limite_usuario';
    end if;
  end if;
  v_modelo := case when v_nivel = 'avanzado' then p_modelo_avanzado else p_modelo_basico end;

  insert into public.ia_consumo (company_id, usuario, peticion_id, funcion, nivel_pedido, nivel, motivo_nivel, proveedor, modelo, importe_estimado_eur)
  values (p_company, lower(p_usuario), p_peticion, left(coalesce(p_funcion, 'general'), 40),
          case when p_nivel = 'avanzado' then 'avanzado' else 'basico' end, v_nivel, v_motivo, p_proveedor, v_modelo,
          case when v_nivel = 'avanzado' then v_est_a else v_est_b end)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'consumo_id', v_id, 'nivel', v_nivel, 'modelo', v_modelo,
                            'degradado', v_nivel <> case when p_nivel = 'avanzado' then 'avanzado' else 'basico' end, 'motivo', v_motivo);
end $$;

-- ============ 2) Liquidar después de la llamada ============
-- Calcula el coste con los tokens reales, lo descuenta (bolsa → extra → exceso) y crea los avisos del 80 % / 100 %.
create or replace function public.ia_liquidar(
  p_consumo uuid, p_company text, p_estado text, p_codigo text, p_modelo text,
  p_in integer, p_out integer, p_cache_r integer, p_cache_w integer, p_duracion integer
) returns jsonb language plpgsql set search_path = public as $$
declare
  c public.ia_consumo; s public.ia_saldo; v_mult numeric; v_coste numeric; v_importe numeric;
  v_bolsa numeric; v_extra numeric; v_resto numeric; v_mes_consumo numeric; v_pct numeric; v_pct_lim numeric;
  v_umbral integer; v_admins text[]; v_avisos jsonb := '[]'::jsonb; v_aviso_id bigint;
begin
  select * into c from public.ia_consumo where id = p_consumo and company_id = p_company for update;
  if not found then return jsonb_build_object('ok', false, 'codigo', 'no_encontrado'); end if;
  if c.estado in ('ok', 'error') then return jsonb_build_object('ok', true, 'repetido', true); end if;

  select coalesce(pl.multiplicador, 1) into v_mult from public.empresas e left join public.ia_planes pl on pl.id = e.plan_id where e.id = p_company;
  perform public.ia_renovar_mes(p_company);
  select * into s from public.ia_saldo where company_id = p_company for update;

  v_coste := coalesce(public.ia_coste(c.proveedor, coalesce(p_modelo, c.modelo), p_in, p_out, p_cache_r, p_cache_w), 0);
  v_importe := round(v_coste * v_mult, 6);

  update public.ia_consumo set
    estado = case when p_estado = 'ok' then 'ok' else 'error' end, codigo_error = p_codigo, modelo = coalesce(p_modelo, modelo),
    tokens_entrada = coalesce(p_in, 0), tokens_salida = coalesce(p_out, 0), tokens_cache_lectura = coalesce(p_cache_r, 0), tokens_cache_escritura = coalesce(p_cache_w, 0),
    coste_real_eur = v_coste, importe_eur = v_importe, importe_estimado_eur = 0, duracion_ms = p_duracion, terminado = now()
  where id = p_consumo;

  -- descontar: primero la bolsa del mes, luego el extra, y lo que sobre queda como exceso (solo nivel básico)
  v_bolsa := least(v_importe, greatest(s.bolsa_restante_eur, 0));
  v_resto := v_importe - v_bolsa;
  v_extra := least(v_resto, greatest(s.extra_eur, 0));
  v_resto := v_resto - v_extra;
  update public.ia_saldo set bolsa_restante_eur = bolsa_restante_eur - v_bolsa, extra_eur = extra_eur - v_extra,
         exceso_mes_eur = exceso_mes_eur + v_resto, actualizado = now()
   where company_id = p_company returning * into s;

  -- porcentaje gastado del mes: lo consumido frente a lo que había (consumido + lo que queda)
  select coalesce(sum(importe_eur), 0) into v_mes_consumo from public.ia_consumo where company_id = p_company and created_at >= public.ia_inicio_mes() and estado <> 'en_curso';
  v_pct := case when s.bolsa_restante_eur + s.extra_eur <= 0 then case when v_mes_consumo > 0 then 100 else 0 end
                else 100 * v_mes_consumo / (v_mes_consumo + s.bolsa_restante_eur + s.extra_eur) end;
  if s.limite_mensual_eur is not null and s.limite_mensual_eur > 0 then
    v_pct_lim := 100 * v_mes_consumo / s.limite_mensual_eur;
    v_pct := greatest(v_pct, v_pct_lim);
  end if;

  if v_importe > 0 then
    foreach v_umbral in array array[80, 100] loop
      if v_pct >= v_umbral then
        select coalesce(array_agg(lower(email)), '{}') into v_admins from public.members where company_id = p_company and role = 'admin';
        insert into public.ia_avisos (company_id, periodo, umbral, porcentaje, destinatarios)
        values (p_company, s.periodo, v_umbral, round(least(v_pct, 999), 2), v_admins)
        on conflict (company_id, periodo, umbral) do nothing
        returning id into v_aviso_id;
        if v_aviso_id is not null then
          v_avisos := v_avisos || jsonb_build_object('umbral', v_umbral, 'porcentaje', round(least(v_pct, 999), 1));
          v_aviso_id := null;
        end if;
      end if;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'coste_eur', v_coste, 'importe_eur', v_importe, 'porcentaje', round(least(v_pct, 999), 1), 'avisos', v_avisos);
end $$;

-- ============ 3) Recargar saldo extra (solo backend / dueño de Synqalia) ============
create or replace function public.ia_recargar(p_company text, p_importe numeric, p_motivo text, p_hecho_por text)
returns numeric language plpgsql set search_path = public as $$
declare v numeric;
begin
  if p_importe is null or p_importe = 0 then raise exception 'Importe no válido'; end if;
  perform public.ia_renovar_mes(p_company);
  insert into public.ia_movimientos (company_id, tipo, importe_eur, motivo, hecho_por)
  values (p_company, case when p_importe > 0 then 'recarga' else 'ajuste' end, p_importe, p_motivo, p_hecho_por);
  update public.ia_saldo set extra_eur = extra_eur + p_importe, actualizado = now() where company_id = p_company returning extra_eur into v;
  return v;
end $$;

-- ============ Auditoría ============
create or replace function public.ia_auditar() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'ia_movimientos' then
    insert into public.audit_log (company_id, accion, detalle) values (new.company_id, 'ia_saldo_' || new.tipo,
      jsonb_build_object('importe_eur', new.importe_eur, 'motivo', new.motivo, 'hecho_por', new.hecho_por));
  elsif tg_table_name = 'ia_saldo' then
    if new.limite_mensual_eur is distinct from old.limite_mensual_eur or new.limite_usuario_eur is distinct from old.limite_usuario_eur then
      insert into public.audit_log (company_id, accion, detalle) values (new.company_id, 'ia_limites',
        jsonb_build_object('antes', jsonb_build_object('mensual', old.limite_mensual_eur, 'usuario', old.limite_usuario_eur),
                           'despues', jsonb_build_object('mensual', new.limite_mensual_eur, 'usuario', new.limite_usuario_eur),
                           'usuario_bd', current_user));
    end if;
  elsif tg_table_name = 'ia_avisos' then
    insert into public.audit_log (company_id, accion, detalle) values (new.company_id, 'ia_aviso_' || new.umbral,
      jsonb_build_object('porcentaje', new.porcentaje, 'periodo', new.periodo, 'destinatarios', new.destinatarios));
  elsif tg_table_name = 'empresas' then
    if new.plan_id is distinct from old.plan_id or new.activa is distinct from old.activa then
      insert into public.audit_log (company_id, accion, detalle) values (new.id, 'empresa_plan',
        jsonb_build_object('plan_antes', old.plan_id, 'plan_despues', new.plan_id, 'activa', new.activa, 'usuario_bd', current_user));
    end if;
  elsif tg_table_name = 'ia_planes' then
    insert into public.audit_log (company_id, accion, detalle) values ('synqalia', 'ia_plan_cambio',
      jsonb_build_object('plan', new.id, 'antes', to_jsonb(old), 'despues', to_jsonb(new), 'usuario_bd', current_user));
  end if;
  return new;
end $$;

drop trigger if exists ia_movimientos_audit on public.ia_movimientos;
create trigger ia_movimientos_audit after insert on public.ia_movimientos for each row execute function public.ia_auditar();
drop trigger if exists ia_saldo_audit on public.ia_saldo;
create trigger ia_saldo_audit after update on public.ia_saldo for each row execute function public.ia_auditar();
drop trigger if exists ia_avisos_audit on public.ia_avisos;
create trigger ia_avisos_audit after insert on public.ia_avisos for each row execute function public.ia_auditar();
drop trigger if exists empresas_audit on public.empresas;
create trigger empresas_audit after update on public.empresas for each row execute function public.ia_auditar();
drop trigger if exists ia_planes_audit on public.ia_planes;
create trigger ia_planes_audit after update on public.ia_planes for each row execute function public.ia_auditar();

-- ============ Permisos ============
-- Por defecto PostgreSQL deja ejecutar funciones a todo el mundo: las del motor solo las usa el backend.
revoke execute on function public.ia_reservar(text, text, text, text, uuid, text, text, text, integer, integer) from public;
revoke execute on function public.ia_liquidar(uuid, text, text, text, text, integer, integer, integer, integer, integer) from public;
revoke execute on function public.ia_recargar(text, numeric, text, text) from public;
revoke execute on function public.ia_renovar_mes(text) from public;
revoke execute on function public.ia_coste(text, text, integer, integer, integer, integer) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.ia_tarifas from anon, authenticated;
    revoke all on public.empresas, public.ia_planes, public.ia_saldo, public.ia_movimientos, public.ia_consumo, public.ia_avisos from anon, authenticated;
    grant select on public.empresas, public.ia_planes, public.ia_saldo, public.ia_movimientos, public.ia_avisos to authenticated;
    -- el coste real (margen de Synqalia) no se enseña a los clientes
    grant select (id, company_id, usuario, peticion_id, funcion, nivel_pedido, nivel, motivo_nivel, proveedor, modelo,
                  tokens_entrada, tokens_salida, tokens_cache_lectura, tokens_cache_escritura, importe_eur, estado, codigo_error,
                  duracion_ms, created_at, terminado) on public.ia_consumo to authenticated;
    revoke execute on function public.app_usuario_actual(), public.app_empresa_actual(), public.app_es_admin_empresa() from anon;
    grant execute on function public.app_usuario_actual(), public.app_empresa_actual(), public.app_es_admin_empresa() to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.ia_reservar(text, text, text, text, uuid, text, text, text, integer, integer),
                              public.ia_liquidar(uuid, text, text, text, text, integer, integer, integer, integer, integer),
                              public.ia_recargar(text, numeric, text, text), public.ia_renovar_mes(text),
                              public.ia_coste(text, text, integer, integer, integer, integer) to service_role;
  end if;
end $$;

-- Respaldo por familia (precios conservadores): si se configura otro modelo de la misma familia sin fila propia,
-- se cobra con estos en vez de bloquear la IA. Las filas más concretas (patrón más largo) tienen preferencia.
insert into public.ia_tarifas (proveedor, patron, usd_entrada_mtok, usd_salida_mtok, eur_por_usd, vigente_desde, nota)
select v.* from (values
  (null::text, 'sonnet', 3::numeric, 15::numeric, 0.89::numeric, '2026-11-01'::timestamptz, 'Respaldo familia Sonnet'),
  (null, 'opus', 5, 25, 0.89, '2026-11-01', 'Respaldo familia Opus'),
  (null, 'haiku', 1, 5, 0.89, '2026-11-01', 'Respaldo familia Haiku'),
  (null, 'fable', 10, 50, 0.89, '2026-11-01', 'Respaldo familia Fable')
) v(proveedor, patron, a, b, c, d, e)
where not exists (select 1 from public.ia_tarifas t where t.patron = v.patron);

-- Las funciones auxiliares solo para usuarios con sesión (PostgreSQL da EXECUTE a PUBLIC por defecto).
revoke execute on function public.app_usuario_actual(), public.app_empresa_actual(), public.app_es_admin_empresa() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.app_usuario_actual(), public.app_empresa_actual(), public.app_es_admin_empresa() to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.app_usuario_actual(), public.app_empresa_actual(), public.app_es_admin_empresa() from anon;
  end if;
end $$;
alter function public.ia_mes_actual() set search_path = public;
alter function public.ia_inicio_mes() set search_path = public;
