-- Carnet de suivi — étape 1 : socle clinique
-- À exécuter sur un Supabase auto-hébergé chez un hébergeur certifié HDS.
--
-- Principes :
--  * identifiants créés sur l'appareil (uuid) → saisie possible hors ligne ;
--  * suppression « douce » (deleted_at) pour que les suppressions se synchronisent ;
--  * server_updated_at posé par le serveur, sert de curseur de synchronisation ;
--  * la version la plus récente (updated_at) gagne : le serveur refuse d'écraser
--    une ligne par une version plus ancienne ;
--  * chaque compte ne voit que ses propres dossiers (RLS simple, sans fonction
--    SECURITY DEFINER). Le partage avec l'équipe arrive à l'étape 3.

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------ helpers

create or replace function public.c2s_before_write() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := coalesce(new.owner_id, auth.uid());
  else
    -- On ne change jamais de propriétaire par une mise à jour.
    new.owner_id := old.owner_id;
    new.created_at := old.created_at;
    -- Version plus ancienne que celle du serveur : ignorée (dernière écriture gagne).
    if new.updated_at < old.updated_at then
      return null;
    end if;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end $$;

-- Journal des modifications (traçabilité exigée pour les données de santé).
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  table_name text not null,
  row_id uuid not null,
  action text not null
);
alter table public.audit_log enable row level security;
create policy audit_read_own on public.audit_log for select using (user_id = auth.uid());

create or replace function public.c2s_audit() returns trigger
language plpgsql as $$
begin
  insert into public.audit_log (table_name, row_id, action)
  values (
    tg_table_name,
    new.id,
    case
      when tg_op = 'INSERT' then 'creation'
      when new.deleted_at is not null and old.deleted_at is null then 'suppression'
      else 'modification'
    end
  );
  return null;
end $$;

-- Le journal est alimenté par le déclencheur, jamais directement par l'application.
revoke insert, update, delete on public.audit_log from anon, authenticated;
alter function public.c2s_audit() security definer set search_path = public;

-- ------------------------------------------------------------------ tables

create table if not exists public.patients (
  id uuid primary key,
  owner_id uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp(),
  first_name text not null default '',
  last_name text not null default '',
  birth_date date,
  status text not null default 'actif'
    check (status in ('actif','bilan','liste_attente','pause','non_suivi','archive')),
  usual_day text,
  usual_time text,
  usual_place text,
  frequency text check (frequency in ('ponctuel','hebdomadaire','bimensuel')),
  day_order integer not null default 0,
  sort_order integer not null default 0,
  school_name text,
  school_class text,
  phone text,
  email text,
  consultation_reason text,
  diagnosis text,
  care_start_date date,
  pinned_info text,
  notes text
);

create table if not exists public.notes (
  id uuid primary key,
  owner_id uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp(),
  patient_id uuid not null references public.patients (id),
  kind text not null default 'seance' check (kind in ('seance','generale')),
  note_date date not null,
  content_html text not null default '',
  raw_text text
);

create table if not exists public.note_versions (
  id uuid primary key,
  owner_id uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp(),
  note_id uuid not null references public.notes (id),
  patient_id uuid not null references public.patients (id),
  content_html text not null,
  saved_at timestamptz not null
);

create table if not exists public.forecasts (
  id uuid primary key,
  owner_id uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp(),
  patient_id uuid not null references public.patients (id),
  content text not null,
  planned_date date,
  status text not null default 'a_faire' check (status in ('a_faire','transferee','abandonnee')),
  note_id uuid references public.notes (id)
);

create table if not exists public.tasks (
  id uuid primary key,
  owner_id uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp(),
  patient_id uuid references public.patients (id),
  title text not null,
  due_date date,
  status text not null default 'a_faire' check (status in ('a_faire','fait')),
  urgent boolean not null default false,
  details text
);

create table if not exists public.assessments (
  id uuid primary key,
  owner_id uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp(),
  patient_id uuid not null references public.patients (id),
  assessment_date date,
  reason text,
  tests_used text,
  results text,
  observations text,
  synthesis text,
  recommendations text
);

create table if not exists public.goals (
  id uuid primary key,
  owner_id uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp(),
  patient_id uuid not null references public.patients (id),
  title text not null,
  smart_statement text,
  status text not null default 'en_cours' check (status in ('en_cours','atteint','suspendu','abandonne')),
  progress integer not null default 0 check (progress between 0 and 100),
  target_date date,
  review_date date,
  sort_order integer not null default 0
);

create table if not exists public.goal_progress (
  id uuid primary key,
  owner_id uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp(),
  goal_id uuid not null references public.goals (id),
  patient_id uuid not null references public.patients (id),
  progress integer not null check (progress between 0 and 100),
  comment text,
  recorded_on date not null
);

-- ------------------------------------------------------------------ triggers, index, RLS

do $$
declare t text;
begin
  foreach t in array array['patients','notes','note_versions','forecasts','tasks','assessments','goals','goal_progress']
  loop
    execute format('create index if not exists %1$s_sync_idx on public.%1$s (owner_id, server_updated_at, id)', t);
    execute format('drop trigger if exists c2s_before_write on public.%1$s', t);
    execute format('create trigger c2s_before_write before insert or update on public.%1$s
                    for each row execute function public.c2s_before_write()', t);
    execute format('drop trigger if exists c2s_audit on public.%1$s', t);
    execute format('create trigger c2s_audit after insert or update on public.%1$s
                    for each row execute function public.c2s_audit()', t);
    execute format('alter table public.%1$s enable row level security', t);
    execute format('alter table public.%1$s force row level security', t);
    -- Aucune suppression physique depuis l'application : uniquement deleted_at.
    execute format('revoke delete on public.%1$s from anon, authenticated', t);
    execute format('drop policy if exists own_select on public.%1$s', t);
    execute format('create policy own_select on public.%1$s for select using (owner_id = auth.uid())', t);
    execute format('drop policy if exists own_update on public.%1$s', t);
    execute format('create policy own_update on public.%1$s for update using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
  end loop;
end $$;

-- Insertion : la ligne appartient au compte connecté, et un élément rattaché
-- à un patient ne peut viser qu'un patient de ce même compte.
drop policy if exists own_insert on public.patients;
create policy own_insert on public.patients for insert
  with check (owner_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['notes','note_versions','forecasts','assessments','goals','goal_progress']
  loop
    execute format('drop policy if exists own_insert on public.%1$s', t);
    execute format('create policy own_insert on public.%1$s for insert with check (
      owner_id = auth.uid()
      and exists (select 1 from public.patients p where p.id = patient_id and p.owner_id = auth.uid()))', t);
  end loop;
end $$;

drop policy if exists own_insert on public.tasks;
create policy own_insert on public.tasks for insert with check (
  owner_id = auth.uid()
  and (patient_id is null
       or exists (select 1 from public.patients p where p.id = patient_id and p.owner_id = auth.uid())));
