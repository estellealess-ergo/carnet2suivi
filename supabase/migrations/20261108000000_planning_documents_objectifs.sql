-- Planning par date, rythme une semaine sur deux, objectifs travaillés en séance.
-- (Les documents joints restent sur l'appareil : pas de table serveur.)

alter table public.patients add column if not exists week_parity text check (week_parity in ('paire','impaire'));
alter table public.notes add column if not exists goal_ids uuid[];

create table if not exists public.day_changes (
  id uuid primary key,
  owner_id uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp(),
  patient_id uuid not null references public.patients (id),
  day date not null,
  kind text not null check (kind in ('ajout','annulation')),
  time text
);
create index if not exists day_changes_sync_idx on public.day_changes (owner_id, server_updated_at, id);
drop trigger if exists c2s_before_write on public.day_changes;
create trigger c2s_before_write before insert or update on public.day_changes
  for each row execute function public.c2s_before_write();
drop trigger if exists c2s_audit on public.day_changes;
create trigger c2s_audit after insert or update on public.day_changes
  for each row execute function public.c2s_audit();
alter table public.day_changes enable row level security;
alter table public.day_changes force row level security;
revoke delete on public.day_changes from anon, authenticated;
drop policy if exists own_select on public.day_changes;
create policy own_select on public.day_changes for select using (
  owner_id = auth.uid() or exists (select 1 from public.patients p where p.id = patient_id));
drop policy if exists own_update on public.day_changes;
create policy own_update on public.day_changes for update
  using (owner_id = auth.uid() or exists (select 1 from public.patients p where p.id = patient_id))
  with check (owner_id = auth.uid() or exists (select 1 from public.patients p where p.id = patient_id));
drop policy if exists own_insert on public.day_changes;
create policy own_insert on public.day_changes for insert with check (
  owner_id = auth.uid() and exists (select 1 from public.patients p where p.id = patient_id));
