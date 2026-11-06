-- Carnet de suivi — étape 3 : équipe du cabinet et espace famille
--
-- Règles d'accès :
--  * un dossier patient est visible par sa propriétaire et par les collègues avec qui
--    il est explicitement partagé (patient_shares) — cloisonnement par défaut ;
--  * tout ce qui est rattaché à un patient suit la visibilité du patient ;
--  * un parent ne voit que sa propre fiche de contact et les comptes rendus publiés
--    pour son enfant, jamais le dossier clinique ;
--  * l'équipe et les invitations sont gérées uniquement par la fonction serveur « team ».

-- ------------------------------------------------------------------ cabinet et équipe

create table if not exists public.practices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.practice_members (
  practice_id uuid not null references public.practices (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'membre' check (role in ('titulaire','membre')),
  display_name text not null default '',
  email text not null default '',
  created_at timestamptz not null default now(),
  primary key (practice_id, user_id)
);

-- Fonction d'aide dans un schéma non exposé : évite la récursion des règles d'accès
-- sur practice_members sans fonction SECURITY DEFINER dans le schéma public.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.my_practice_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select practice_id from public.practice_members where user_id = auth.uid()
$$;
revoke all on function private.my_practice_ids() from public;
grant execute on function private.my_practice_ids() to authenticated;

alter table public.practices enable row level security;
alter table public.practice_members enable row level security;
revoke insert, update, delete on public.practices, public.practice_members from anon, authenticated;

drop policy if exists member_read on public.practices;
create policy member_read on public.practices for select
  using (id in (select private.my_practice_ids()));
drop policy if exists member_read on public.practice_members;
create policy member_read on public.practice_members for select
  using (practice_id in (select private.my_practice_ids()));

-- ------------------------------------------------------------------ partage des dossiers

create table if not exists public.patient_shares (
  id uuid primary key,
  owner_id uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp(),
  patient_id uuid not null references public.patients (id),
  user_id uuid not null references auth.users (id),
  patient_owner_id uuid references auth.users (id)
);
create index if not exists patient_shares_user_idx on public.patient_shares (user_id, patient_id) where deleted_at is null;
create index if not exists patient_shares_sync_idx on public.patient_shares (owner_id, server_updated_at, id);

drop trigger if exists c2s_before_write on public.patient_shares;
create trigger c2s_before_write before insert or update on public.patient_shares
  for each row execute function public.c2s_before_write();
drop trigger if exists c2s_audit on public.patient_shares;
create trigger c2s_audit after insert or update on public.patient_shares
  for each row execute function public.c2s_audit();
alter table public.patient_shares enable row level security;
alter table public.patient_shares force row level security;
revoke delete on public.patient_shares from anon, authenticated;

-- Ces règles ne consultent pas la table patients : pas de récursion possible.
drop policy if exists share_select on public.patient_shares;
create policy share_select on public.patient_shares for select
  using (user_id = auth.uid() or patient_owner_id = auth.uid());
drop policy if exists share_update on public.patient_shares;
create policy share_update on public.patient_shares for update
  using (patient_owner_id = auth.uid()) with check (patient_owner_id = auth.uid());
drop policy if exists share_insert on public.patient_shares;
create policy share_insert on public.patient_shares for insert with check (
  owner_id = auth.uid()
  and patient_owner_id = auth.uid()
  and exists (select 1 from public.patients p where p.id = patient_id and p.owner_id = auth.uid())
  -- On ne partage qu'avec une collègue du même cabinet.
  and exists (select 1 from public.practice_members m
              where m.user_id = patient_shares.user_id
                and m.practice_id in (select private.my_practice_ids())));

-- ------------------------------------------------------------------ patients

drop policy if exists own_select on public.patients;
create policy own_select on public.patients for select using (
  owner_id = auth.uid()
  or exists (select 1 from public.patient_shares s
             where s.patient_id = patients.id and s.user_id = auth.uid() and s.deleted_at is null));

drop policy if exists own_update on public.patients;
create policy own_update on public.patients for update
  using (
    owner_id = auth.uid()
    or exists (select 1 from public.patient_shares s
               where s.patient_id = patients.id and s.user_id = auth.uid() and s.deleted_at is null))
  with check (true);

-- ------------------------------------------------------------------ éléments rattachés à un patient
-- Visibles si le patient est visible (la règle de patients s'applique dans la sous-requête).

do $$
declare t text;
begin
  foreach t in array array['notes','note_versions','forecasts','assessments','goals','goal_progress','guardians','family_reports']
  loop
    execute format('drop policy if exists own_select on public.%1$s', t);
    execute format('create policy own_select on public.%1$s for select using (
      owner_id = auth.uid() or exists (select 1 from public.patients p where p.id = patient_id))', t);
    execute format('drop policy if exists own_update on public.%1$s', t);
    execute format('create policy own_update on public.%1$s for update using (
      owner_id = auth.uid() or exists (select 1 from public.patients p where p.id = patient_id))
      with check (owner_id = auth.uid() or exists (select 1 from public.patients p where p.id = patient_id))', t);
    execute format('drop policy if exists own_insert on public.%1$s', t);
    execute format('create policy own_insert on public.%1$s for insert with check (
      owner_id = auth.uid() and exists (select 1 from public.patients p where p.id = patient_id))', t);
  end loop;
  foreach t in array array['tasks','communications']
  loop
    execute format('drop policy if exists own_select on public.%1$s', t);
    execute format('create policy own_select on public.%1$s for select using (
      owner_id = auth.uid()
      or (patient_id is not null and exists (select 1 from public.patients p where p.id = patient_id)))', t);
    execute format('drop policy if exists own_update on public.%1$s', t);
    execute format('create policy own_update on public.%1$s for update using (
      owner_id = auth.uid()
      or (patient_id is not null and exists (select 1 from public.patients p where p.id = patient_id)))
      with check (owner_id = auth.uid()
      or (patient_id is not null and exists (select 1 from public.patients p where p.id = patient_id)))', t);
    execute format('drop policy if exists own_insert on public.%1$s', t);
    execute format('create policy own_insert on public.%1$s for insert with check (
      owner_id = auth.uid()
      and (patient_id is null or exists (select 1 from public.patients p where p.id = patient_id)))', t);
  end loop;
end $$;

-- ------------------------------------------------------------------ espace famille

-- Un parent voit sa propre fiche de contact…
drop policy if exists family_self on public.guardians;
create policy family_self on public.guardians for select using (user_id = auth.uid() and deleted_at is null);

-- … et les comptes rendus publiés pour son enfant. Rien d'autre.
drop policy if exists family_read on public.family_reports;
create policy family_read on public.family_reports for select using (
  published and deleted_at is null
  and exists (select 1 from public.guardians g
              where g.patient_id = family_reports.patient_id
                and g.user_id = auth.uid() and g.deleted_at is null));
