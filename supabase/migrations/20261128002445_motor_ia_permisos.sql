-- Synqalia · Motor IA: permisos de las funciones de sesión (copia de la migración aplicada el 28/11/2026, 00:24 UTC)
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
