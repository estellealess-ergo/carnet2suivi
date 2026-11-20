-- Catégorie des activités enregistrées (facultative, libre).
alter table public.activities add column if not exists category text;
