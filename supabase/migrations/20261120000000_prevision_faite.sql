-- Une prévision peut être cochée « faite » depuis l'accueil.
alter table public.forecasts drop constraint if exists forecasts_status_check;
alter table public.forecasts add constraint forecasts_status_check check (status in ('a_faire','transferee','abandonnee','faite'));
