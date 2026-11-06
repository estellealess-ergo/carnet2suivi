-- Carnet de suivi — étape 2 : communications et familles
-- Mêmes principes que l'étape 1 (identifiants créés sur l'appareil, suppression douce,
-- curseur serveur, dernière écriture gagne, journal).

create table if not exists public.guardians (
  id uuid primary key,
  owner_id uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp(),
  patient_id uuid not null references public.patients (id),
  civility text check (civility in ('Madame','Monsieur')),
  first_name text not null default '',
  last_name text not null default '',
  relation text,
  email text,
  phone text,
  receives_reports boolean not null default true,
  -- Compte de l'espace famille, posé uniquement par le serveur (fonction d'invitation).
  user_id uuid references auth.users (id)
);

create table if not exists public.communications (
  id uuid primary key,
  owner_id uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp(),
  patient_id uuid references public.patients (id),
  channel text not null check (channel in ('email','appel','vocal','sms','whatsapp','autre')),
  direction text not null check (direction in ('entrant','sortant')),
  occurred_at timestamptz not null,
  counterpart text,
  subject text,
  body text,
  -- Informations clés de l'échange. Aucun enregistrement audio n'est fait.
  summary text,
  status text not null default 'a_traiter' check (status in ('a_traiter','traite')),
  external_id text,
  thread_id text
);
create unique index if not exists communications_external_uidx
  on public.communications (owner_id, external_id) where external_id is not null;

create table if not exists public.family_reports (
  id uuid primary key,
  owner_id uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp(),
  patient_id uuid not null references public.patients (id),
  note_id uuid references public.notes (id),
  report_date date not null,
  content text not null default '',
  status text not null default 'brouillon' check (status in ('brouillon','envoye')),
  sent_at timestamptz,
  sent_via text,
  recipients text,
  published boolean not null default false,
  patient_first_name text not null default ''
);

-- Comptes de messagerie reliés (Gmail). Le jeton d'accès n'est lisible que par
-- les fonctions serveur (clé de service).
create table if not exists public.mail_accounts (
  user_id uuid primary key references auth.users (id),
  provider text not null default 'gmail',
  email text not null,
  refresh_token text not null,
  last_history_id text,
  last_sync_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.mail_accounts enable row level security;
alter table public.mail_accounts force row level security;
revoke all on public.mail_accounts from anon, authenticated;

-- L'application peut seulement voir l'état de SA liaison, jamais le jeton.
grant select (user_id, provider, email, last_sync_at) on public.mail_accounts to authenticated;
drop policy if exists own_read on public.mail_accounts;
create policy own_read on public.mail_accounts for select using (user_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['guardians','communications','family_reports']
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
    execute format('revoke delete on public.%1$s from anon, authenticated', t);
    execute format('drop policy if exists own_select on public.%1$s', t);
    execute format('create policy own_select on public.%1$s for select using (owner_id = auth.uid())', t);
    execute format('drop policy if exists own_update on public.%1$s', t);
    execute format('create policy own_update on public.%1$s for update using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
  end loop;
end $$;

drop policy if exists own_insert on public.guardians;
create policy own_insert on public.guardians for insert with check (
  owner_id = auth.uid()
  and exists (select 1 from public.patients p where p.id = patient_id and p.owner_id = auth.uid()));

drop policy if exists own_insert on public.family_reports;
create policy own_insert on public.family_reports for insert with check (
  owner_id = auth.uid()
  and exists (select 1 from public.patients p where p.id = patient_id and p.owner_id = auth.uid()));

drop policy if exists own_insert on public.communications;
create policy own_insert on public.communications for insert with check (
  owner_id = auth.uid()
  and (patient_id is null
       or exists (select 1 from public.patients p where p.id = patient_id and p.owner_id = auth.uid())));

-- Le compte famille d'un responsable légal ne peut pas être posé depuis l'application.
create or replace function public.c2s_guardian_user_guard() returns trigger
language plpgsql as $$
begin
  if current_user in ('anon','authenticated') then
    if tg_op = 'INSERT' then
      new.user_id := null;
    else
      new.user_id := old.user_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists c2s_guardian_user_guard on public.guardians;
create trigger c2s_guardian_user_guard before insert or update on public.guardians
  for each row execute function public.c2s_guardian_user_guard();
