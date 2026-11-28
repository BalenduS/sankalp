-- Which parts of a multi-part text a sadhana reads (e.g. the chosen Navagraha grahas); null = all
alter table public.sk_sadhanas add column if not exists texts text[];
