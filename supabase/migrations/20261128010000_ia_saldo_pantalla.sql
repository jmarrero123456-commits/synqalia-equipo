-- Synqalia · Configuración › IA y saldo (28/11/2026), sobre el Motor IA común (migración motor_ia).
-- Añade lo que necesita la pantalla y el motor aún no tenía:
--   · ia_personas: nivel de IA permitido y límite propio por persona, y si ha pedido la IA avanzada.
--   · ia_saldo.al_tope: qué pasa al acabarse el saldo ('ahorro' = como hasta ahora: la avanzada baja a básica y la
--     básica sigue; 'pausar' = la IA se para hasta el mes siguiente o hasta recargar). Avisos 80/100 % activables.
--   · ia_solicitudes: solicitudes de saldo a Synqalia y pagos con tarjeta (Stripe). Al aprobarse o pagarse,
--     el saldo entra con ia_recargar (movimiento «recarga» y auditoría del motor).
--   · ia_plataforma: ajustes del propietario (saldo de Anthropic apuntado a mano, umbrales de aviso, margen mínimo).
--   · ia_reservar: respeta el nivel y el límite de cada persona y la opción «pausar». Con los valores por defecto
--     se comporta igual que antes, salvo que la IA avanzada ya solo la usa quien la tiene asignada.
--   · ia_agregado e ia_meses: totales para las pantallas.
-- PostgreSQL estándar. RLS activado; la web no lee estas tablas (todo pasa por la función «ia-saldo», que filtra
-- por company_id). Auditoría de cambios en audit_log.

create table if not exists public.ia_personas (
  company_id     text not null references public.empresas(id),
  email          text not null,
  nivel          text not null default 'basico' check (nivel in ('basico', 'avanzado')),
  limite_eur     numeric(12,4),             -- null = el de la empresa (ia_saldo.limite_usuario_eur)
  pide_avanzado  timestamptz,
  updated_at     timestamptz not null default now(),
  updated_by     text,
  primary key (company_id, email)
);

alter table public.ia_saldo add column if not exists al_tope text not null default 'ahorro';
alter table public.ia_saldo add column if not exists aviso_80 boolean not null default true;
alter table public.ia_saldo add column if not exists aviso_100 boolean not null default true;
alter table public.ia_saldo add column if not exists updated_by text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ia_saldo_al_tope_check') then
    alter table public.ia_saldo add constraint ia_saldo_al_tope_check check (al_tope in ('ahorro', 'pausar'));
  end if;
end $$;

create table if not exists public.ia_solicitudes (
  id              uuid primary key default gen_random_uuid(),
  company_id      text not null references public.empresas(id),
  tipo            text not null check (tipo in ('solicitud', 'tarjeta')),
  importe_eur     numeric(12,2) not null check (importe_eur > 0),
  estado          text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada', 'pagada', 'cancelada')),
  solicitado_por  text,
  resuelto_por    text,
  nota            text,
  stripe_session  text unique,
  created_at      timestamptz not null default now(),
  resuelto_at     timestamptz
);
create index if not exists ia_solicitudes_company_idx on public.ia_solicitudes (company_id, created_at desc);

create table if not exists public.ia_plataforma (
  id                     int primary key default 1 check (id = 1),
  anthropic_saldo_usd    numeric(12,2),
  anthropic_saldo_fecha  timestamptz,
  anthropic_recarga_auto boolean not null default false,
  aviso_saldo_usd        numeric(10,2) not null default 100,
  gasto_disparado_pct    int not null default 150,
  margen_min_pct         int not null default 60,
  updated_at             timestamptz not null default now(),
  updated_by             text
);
insert into public.ia_plataforma (id) values (1) on conflict (id) do nothing;

alter table public.ia_personas    enable row level security;
alter table public.ia_solicitudes enable row level security;
alter table public.ia_plataforma  enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.ia_personas, public.ia_solicitudes, public.ia_plataforma from anon, authenticated;
  end if;
end $$;

-- Reserva: igual que la del motor, más el nivel y el límite de cada persona y la opción «pausar».
create or replace function public.ia_reservar(
  p_company text, p_usuario text, p_funcion text, p_nivel text, p_peticion uuid,
  p_proveedor text, p_modelo_basico text, p_modelo_avanzado text,
  p_tokens_entrada integer, p_tokens_salida integer
) returns jsonb language plpgsql set search_path = public as $$
declare
  s public.ia_saldo; p public.ia_planes; e public.empresas; pe public.ia_personas;
  v_mult numeric; v_est_b numeric; v_est_a numeric; v_reservado numeric; v_mes_consumo numeric; v_usr_consumo numeric;
  v_disponible numeric; v_nivel text := case when p_nivel = 'avanzado' then 'avanzado' else 'basico' end; v_motivo text; v_modelo text; v_id uuid;
  v_lim_usr numeric;
begin
  if not exists (select 1 from public.members where lower(email) = lower(p_usuario) and company_id = p_company) then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;
  select * into e from public.empresas where id = p_company;
  if not found or not e.activa then return jsonb_build_object('ok', false, 'codigo', 'no_autorizado'); end if;
  select * into p from public.ia_planes where id = e.plan_id;
  if not found then return jsonb_build_object('ok', false, 'codigo', 'sin_plan'); end if;
  v_mult := p.multiplicador;
  select * into pe from public.ia_personas where company_id = p_company and email = lower(p_usuario);

  perform public.ia_renovar_mes(p_company);
  select * into s from public.ia_saldo where company_id = p_company for update;
  v_lim_usr := coalesce(pe.limite_eur, s.limite_usuario_eur);

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

  if p.tope_seguridad_eur is not null and v_mes_consumo + v_reservado + v_est_b > p.tope_seguridad_eur then
    return jsonb_build_object('ok', false, 'codigo', 'tope');
  end if;

  if v_nivel = 'avanzado' then
    v_disponible := s.bolsa_restante_eur + s.extra_eur - v_reservado;
    if not p.avanzado then v_nivel := 'basico'; v_motivo := 'plan';
    elsif coalesce(pe.nivel, 'basico') <> 'avanzado' then v_nivel := 'basico'; v_motivo := 'nivel';
    elsif s.limite_mensual_eur is not null and v_mes_consumo + v_reservado + v_est_a > s.limite_mensual_eur then v_nivel := 'basico'; v_motivo := 'limite_empresa';
    elsif v_disponible < v_est_a then v_nivel := 'basico'; v_motivo := 'sin_saldo';
    elsif v_lim_usr is not null and v_usr_consumo + v_est_a > v_lim_usr then v_nivel := 'basico'; v_motivo := 'limite_usuario';
    end if;
  end if;

  -- Opción «pausar»: sin saldo, por encima del límite de la empresa o de la persona, la IA se para.
  if s.al_tope = 'pausar' then
    if s.bolsa_restante_eur + s.extra_eur - v_reservado <= 0
       or (s.limite_mensual_eur is not null and v_mes_consumo + v_reservado >= s.limite_mensual_eur) then
      return jsonb_build_object('ok', false, 'codigo', 'tope');
    end if;
    if v_lim_usr is not null and v_usr_consumo >= v_lim_usr then
      return jsonb_build_object('ok', false, 'codigo', 'limite_usuario');
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

-- Totales para las pantallas (solo peticiones terminadas)
create or replace function public.ia_agregado(p_company text, p_desde timestamptz, p_hasta timestamptz default null)
returns table (company_id text, usuario text, funcion text, usos bigint, importe_eur numeric, coste_eur numeric)
language sql stable set search_path = public as $$
  select c.company_id, c.usuario, c.funcion, count(*), coalesce(sum(c.importe_eur), 0), coalesce(sum(c.coste_real_eur), 0)
  from public.ia_consumo c
  where (p_company is null or c.company_id = p_company) and c.estado = 'ok'
    and c.created_at >= p_desde and (p_hasta is null or c.created_at < p_hasta)
  group by 1, 2, 3
$$;

create or replace function public.ia_meses(p_desde timestamptz)
returns table (mes text, importe_eur numeric, coste_eur numeric, usos bigint)
language sql stable set search_path = public as $$
  select to_char(date_trunc('month', created_at at time zone 'Europe/Madrid'), 'YYYY-MM'), sum(importe_eur), sum(coste_real_eur), count(*)
  from public.ia_consumo where estado = 'ok' and created_at >= p_desde group by 1 order by 1
$$;

-- Auditoría de lo que añade esta pantalla (el motor ya audita movimientos, límites, avisos, planes y empresas)
create or replace function public.ia_auditar_pantalla() returns trigger language plpgsql set search_path = public as $$
declare v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end; v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
begin
  if tg_table_name = 'ia_saldo' then
    if v_old->'al_tope' is not distinct from v_new->'al_tope' and v_old->'aviso_80' is not distinct from v_new->'aviso_80'
       and v_old->'aviso_100' is not distinct from v_new->'aviso_100' then return new; end if;
    v_old := jsonb_build_object('al_tope', v_old->'al_tope', 'aviso_80', v_old->'aviso_80', 'aviso_100', v_old->'aviso_100');
    v_new := jsonb_build_object('al_tope', v_new->'al_tope', 'aviso_80', v_new->'aviso_80', 'aviso_100', v_new->'aviso_100', 'updated_by', v_new->'updated_by');
  end if;
  insert into public.audit_log (company_id, accion, detalle)
  values (coalesce(v_new->>'company_id', v_old->>'company_id', 'synqalia'), 'ia.' || tg_table_name || '.' || lower(tg_op),
          jsonb_build_object('por', coalesce(v_new->>'updated_by', v_new->>'resuelto_por', v_new->>'solicitado_por', v_old->>'updated_by'), 'antes', v_old, 'despues', v_new));
  return coalesce(new, old);
end $$;

drop trigger if exists ia_personas_audit on public.ia_personas;
create trigger ia_personas_audit after insert or update or delete on public.ia_personas for each row execute function public.ia_auditar_pantalla();
drop trigger if exists ia_solicitudes_audit on public.ia_solicitudes;
create trigger ia_solicitudes_audit after insert or update on public.ia_solicitudes for each row execute function public.ia_auditar_pantalla();
drop trigger if exists ia_plataforma_audit on public.ia_plataforma;
create trigger ia_plataforma_audit after update on public.ia_plataforma for each row execute function public.ia_auditar_pantalla();
drop trigger if exists ia_saldo_opciones_audit on public.ia_saldo;
create trigger ia_saldo_opciones_audit after update on public.ia_saldo for each row execute function public.ia_auditar_pantalla();

revoke execute on function public.ia_agregado(text, timestamptz, timestamptz) from public;
revoke execute on function public.ia_meses(timestamptz) from public;
revoke execute on function public.ia_reservar(text, text, text, text, uuid, text, text, text, integer, integer) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.ia_agregado(text, timestamptz, timestamptz), public.ia_meses(timestamptz),
      public.ia_reservar(text, text, text, text, uuid, text, text, text, integer, integer), public.ia_inicio_mes(), public.ia_mes_actual() to service_role;
  end if;
end $$;
