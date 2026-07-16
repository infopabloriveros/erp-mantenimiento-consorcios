create table if not exists public.erp_rows (
  table_name text not null,
  row_id text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (table_name, row_id)
);

create index if not exists erp_rows_table_name_idx
  on public.erp_rows (table_name);

create or replace function public.set_erp_rows_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_erp_rows_updated_at on public.erp_rows;

create trigger set_erp_rows_updated_at
before update on public.erp_rows
for each row
execute function public.set_erp_rows_updated_at();

alter table public.erp_rows enable row level security;

drop policy if exists "Service role full access" on public.erp_rows;

create policy "Service role full access"
on public.erp_rows
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
