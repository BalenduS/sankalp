-- Sadhanas practised one after another (e.g. Argala → Devi Suktam → Kunjika)
alter table public.sk_sadhanas drop constraint sk_sadhanas_status_check;
alter table public.sk_sadhanas add constraint sk_sadhanas_status_check check (status in ('active','completed','broken','stopped','queued'));
alter table public.sk_sadhanas add column series_id uuid;
alter table public.sk_sadhanas add column series_order int;
alter table public.sk_sadhanas add column series_title text;
create index sk_sadhanas_series on public.sk_sadhanas(series_id) where series_id is not null;
