-- Bibliothèque d'activités : modèles à compléter en un clic dans les notes de séance.

create table if not exists public.activities (
  id uuid primary key,
  owner_id uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp(),
  title text not null,
  template text not null,
  rubric text not null default 'fait' check (rubric in ('fait','observe','reprendre')),
  sort_order integer not null default 0
);
create index if not exists activities_sync_idx on public.activities (owner_id, server_updated_at, id);
drop trigger if exists c2s_before_write on public.activities;
create trigger c2s_before_write before insert or update on public.activities
  for each row execute function public.c2s_before_write();
drop trigger if exists c2s_audit on public.activities;
create trigger c2s_audit after insert or update on public.activities
  for each row execute function public.c2s_audit();
alter table public.activities enable row level security;
alter table public.activities force row level security;
revoke delete on public.activities from anon, authenticated;
drop policy if exists own_select on public.activities;
create policy own_select on public.activities for select using (owner_id = auth.uid());
drop policy if exists own_update on public.activities;
create policy own_update on public.activities for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists own_insert on public.activities;
create policy own_insert on public.activities for insert with check (owner_id = auth.uid());
