-- Lien avec la tâche correspondante dans Google Tasks (liste « Carnet de suivi »).
alter table public.tasks add column if not exists google_task_id text;
alter table public.forecasts add column if not exists google_task_id text;
