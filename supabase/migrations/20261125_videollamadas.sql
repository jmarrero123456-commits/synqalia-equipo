-- synqalia · videollamadas desde el chat (25/11/2026)
-- Una fila por llamada de un chat. proveedor: 'synqalia' (sala propia LiveKit) o 'teams' (reunión de Teams creada al momento).
-- Solo la función «llamada» (service_role) crea y cambia filas; los integrantes del chat las leen (RLS) y les llegan por Realtime.
-- SQL estándar de PostgreSQL (portable a RDS); las funciones de Supabase solo se usan en las políticas (me_email, is_chat_member).
create table if not exists public.calls (
  id          uuid primary key default gen_random_uuid(),
  chat_id     uuid not null references public.chats(id) on delete cascade,
  proveedor   text not null check (proveedor in ('synqalia', 'teams')),
  sala        text,
  join_url    text,
  started_by  text not null,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  participants text[] not null default '{}',   -- quién está dentro ahora
  joined      text[] not null default '{}',   -- quién ha entrado alguna vez
  declined    text[] not null default '{}'    -- quién la ha rechazado
);
create index if not exists calls_chat_idx on public.calls (chat_id, started_at desc);

alter table public.calls enable row level security;
drop policy if exists calls_read on public.calls;
create policy calls_read on public.calls for select using (public.is_chat_member(chat_id));
-- sin políticas de insert/update/delete: solo service_role

-- Entrar / salir / rechazar de forma atómica (las llama la función «llamada»).
create or replace function public.call_join(p_call uuid, p_email text) returns public.calls
language sql security definer set search_path = public as $$
  update calls set
    participants = case when p_email = any(participants) then participants else array_append(participants, p_email) end,
    joined       = case when p_email = any(joined) then joined else array_append(joined, p_email) end,
    declined     = array_remove(declined, p_email)
  where id = p_call and ended_at is null
  returning *;
$$;

-- Al salir: si no queda nadie dentro, la llamada termina.
create or replace function public.call_leave(p_call uuid, p_email text) returns public.calls
language sql security definer set search_path = public as $$
  update calls set
    participants = array_remove(participants, p_email),
    ended_at = case when cardinality(array_remove(participants, p_email)) = 0 then now() else ended_at end
  where id = p_call and ended_at is null
  returning *;
$$;

-- Rechazar: en un chat directo, si quien llama sigue solo, la llamada termina.
create or replace function public.call_decline(p_call uuid, p_email text, p_end boolean) returns public.calls
language sql security definer set search_path = public as $$
  update calls set
    declined = case when p_email = any(declined) then declined else array_append(declined, p_email) end,
    ended_at = case when p_end and cardinality(array_remove(participants, p_email)) <= 1 then now() else ended_at end
  where id = p_call and ended_at is null
  returning *;
$$;

revoke all on function public.call_join(uuid, text) from public, anon, authenticated;
revoke all on function public.call_leave(uuid, text) from public, anon, authenticated;
revoke all on function public.call_decline(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.call_join(uuid, text) to service_role;
grant execute on function public.call_leave(uuid, text) to service_role;
grant execute on function public.call_decline(uuid, text, boolean) to service_role;

alter publication supabase_realtime add table public.calls;
