-- Nom(s) du patient tel(s) qu'écrit(s) dans Google Agenda (ex. « Milo P. »), pour reconnaître les rendez-vous.
alter table public.patients add column if not exists calendar_names text[];
