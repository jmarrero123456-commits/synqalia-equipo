-- Synqalia · Saldo de IA por usuario (28/11/2026)
-- Decisión de Jaime: el saldo de IA de una empresa crece con sus usuarios (hoy 6 € por usuario y mes), en vez de una
-- cantidad fija. Cuenta como usuario cada miembro activado (members.activated = true) de la empresa.
--   · ia_planes.bolsa_por_usuario_eur: lo que suma cada usuario activo a la bolsa del mes (además de bolsa_mensual_eur).
--   · ia_renovar_mes: el día 1 la bolsa = bolsa_mensual_eur + bolsa_por_usuario_eur × usuarios activos.
--   · Al activarse un usuario a mitad de mes, su parte se suma en ese momento (movimiento «bolsa_mensual»).
--   · Plan «interno» (Provalliance): 0 € fijos + 6 € por usuario. El mes en curso se recalcula restando lo ya gastado.
-- PostgreSQL estándar. Auditoría: los movimientos ya pasan a audit_log con el trigger del motor.

alter table public.ia_planes add column if not exists bolsa_por_usuario_eur numeric(12,4) not null default 0;

create or replace function public.ia_usuarios_activos(p_company text) returns integer
language sql stable set search_path = public as $$
  select count(*)::int from public.members where company_id = p_company and coalesce(activated, false)
$$;

create or replace function public.ia_bolsa_plan(p_company text) returns numeric
language sql stable set search_path = public as $$
  select coalesce(p.bolsa_mensual_eur, 0) + coalesce(p.bolsa_por_usuario_eur, 0) * public.ia_usuarios_activos(p_company)
  from public.empresas e left join public.ia_planes p on p.id = e.plan_id where e.id = p_company
$$;

create or replace function public.ia_renovar_mes(p_company text) returns void
language plpgsql set search_path = public as $$
declare v_mes date := public.ia_mes_actual(); v_bolsa numeric;
begin
  insert into public.ia_saldo (company_id) values (p_company) on conflict do nothing;
  v_bolsa := coalesce(public.ia_bolsa_plan(p_company), 0);
  update public.ia_saldo set periodo = v_mes, bolsa_restante_eur = v_bolsa, exceso_mes_eur = 0, actualizado = now()
   where company_id = p_company and periodo < v_mes;
  if found then
    insert into public.ia_movimientos (company_id, tipo, importe_eur, motivo, hecho_por)
    values (p_company, 'bolsa_mensual', v_bolsa,
            'Bolsa del plan para ' || to_char(v_mes, 'MM/YYYY') || ' (' || public.ia_usuarios_activos(p_company) || ' usuarios)', 'sistema');
  end if;
end $$;

-- Alta de un usuario (o activación) a mitad de mes: se suma su parte a la bolsa en ese momento
create or replace function public.ia_alta_usuario() returns trigger language plpgsql security definer set search_path = public as $$
declare v_x numeric;
begin
  if not coalesce(new.activated, false) then return new; end if;
  if tg_op = 'UPDATE' and coalesce(old.activated, false) and old.company_id is not distinct from new.company_id then return new; end if;
  select coalesce(p.bolsa_por_usuario_eur, 0) into v_x from public.empresas e join public.ia_planes p on p.id = e.plan_id where e.id = new.company_id;
  if coalesce(v_x, 0) <= 0 then return new; end if;
  perform public.ia_renovar_mes(new.company_id);  -- si el mes ya ha cambiado, la renovación ya le cuenta
  if exists (select 1 from public.ia_movimientos where company_id = new.company_id and tipo = 'bolsa_mensual'
             and created_at >= public.ia_inicio_mes() and motivo = 'Alta de usuario: ' || lower(new.email)) then return new; end if;
  update public.ia_saldo set bolsa_restante_eur = bolsa_restante_eur + v_x, actualizado = now() where company_id = new.company_id;
  insert into public.ia_movimientos (company_id, tipo, importe_eur, motivo, hecho_por)
  values (new.company_id, 'bolsa_mensual', v_x, 'Alta de usuario: ' || lower(new.email), 'sistema');
  return new;
end $$;

drop trigger if exists members_ia_alta on public.members;
create trigger members_ia_alta after insert or update of activated, company_id on public.members
  for each row execute function public.ia_alta_usuario();

-- Plan interno: 6 € por usuario y mes, sin cantidad fija. Mes en curso: bolsa nueva menos lo ya gastado.
do $$
declare v_antes numeric; v_nueva numeric; v_gastado numeric;
begin
  update public.ia_planes set bolsa_mensual_eur = 0, bolsa_por_usuario_eur = 6 where id = 'interno';
  for v_antes, v_gastado in
    select s.bolsa_restante_eur, coalesce((select sum(m.importe_eur) from public.ia_movimientos m
             where m.company_id = s.company_id and m.tipo = 'bolsa_mensual' and m.created_at >= public.ia_inicio_mes()), 0) - s.bolsa_restante_eur
      from public.ia_saldo s join public.empresas e on e.id = s.company_id where e.plan_id = 'interno' and s.company_id = 'provalliance'
  loop
    v_nueva := greatest(public.ia_bolsa_plan('provalliance') - greatest(v_gastado, 0), 0);
    if v_nueva <> v_antes then
      update public.ia_saldo set bolsa_restante_eur = v_nueva, actualizado = now() where company_id = 'provalliance';
      insert into public.ia_movimientos (company_id, tipo, importe_eur, motivo, hecho_por)
      values ('provalliance', 'ajuste', v_nueva - v_antes, 'Cambio a 6 € por usuario activo (' || public.ia_usuarios_activos('provalliance') || ' usuarios)', 'sistema');
    end if;
  end loop;
end $$;

revoke execute on function public.ia_usuarios_activos(text), public.ia_bolsa_plan(text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.ia_usuarios_activos(text), public.ia_bolsa_plan(text) to service_role;
  end if;
end $$;
