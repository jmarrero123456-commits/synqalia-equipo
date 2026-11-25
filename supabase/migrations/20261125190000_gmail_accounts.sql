-- Synqalia · Gmail conectado (25/11/2026)
-- Cuentas de Gmail / Google Workspace de cada usuario (varias por usuario) y registro de auditoría.
-- PostgreSQL estándar. El refresh_token se guarda CIFRADO por la aplicación (AES-GCM, clave en la variable TOKEN_KEY):
-- la base de datos nunca lo ve en claro. La web no lee esta tabla: todo pasa por la función «gmail»,
-- que filtra siempre por owner y company_id (además de RLS).

create table if not exists public.gmail_accounts (
  id            uuid primary key default gen_random_uuid(),
  company_id    text not null default 'provalliance',
  owner         uuid not null references auth.users(id) on delete cascade,
  email         text not null,
  nombre        text,
  refresh_token text not null,          -- cifrado (iv.datos en base64url)
  scopes        text,
  color         text,
  connected_at  timestamptz not null default now(),
  last_ok       timestamptz,
  last_error    text,
  state         jsonb not null default '{}'::jsonb,
  unique (owner, email)
);
create index if not exists gmail_accounts_owner_idx on public.gmail_accounts (company_id, owner);

alter table public.gmail_accounts enable row level security;
-- Sin políticas para anon/authenticated: solo el backend (rol de servicio) lee y escribe.
revoke all on public.gmail_accounts from anon, authenticated;

create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  company_id  text not null default 'provalliance',
  owner       uuid,
  accion      text not null,
  detalle     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_log_company_idx on public.audit_log (company_id, created_at desc);
alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
