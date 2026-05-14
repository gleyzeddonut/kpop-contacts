-- Run AFTER migration_v2_status_notes.sql
-- K:CONTACTS — Briefs table

create table public.briefs (
  id                   uuid primary key default gen_random_uuid(),
  list_id              uuid references public.lists(id) on delete cascade not null,
  artist_id            uuid references public.artists(id) on delete cascade not null,
  source_pdf           text,
  label                text,
  deadline             text,
  general_direction    text,
  track_types          jsonb default '[]',
  submission_emails    text[] default '{}',
  matched_contact_ids  uuid[] default '{}',
  created_at           timestamptz default now()
);

alter table public.briefs enable row level security;

-- Owner has full access
create policy "list owner full access"
  on public.briefs for all
  using (
    exists (select 1 from public.lists where id = briefs.list_id and owner_id = auth.uid())
  )
  with check (
    exists (select 1 from public.lists where id = briefs.list_id and owner_id = auth.uid())
  );

-- Editors can read and write
create policy "editors can read and write briefs"
  on public.briefs for all
  using (
    exists (
      select 1 from public.list_shares
      where list_id = briefs.list_id
        and shared_with_email = (auth.jwt() ->> 'email')
        and role = 'editor'
    )
  )
  with check (
    exists (
      select 1 from public.list_shares
      where list_id = briefs.list_id
        and shared_with_email = (auth.jwt() ->> 'email')
        and role = 'editor'
    )
  );

-- Viewers can read
create policy "viewers can read briefs"
  on public.briefs for select
  using (
    exists (
      select 1 from public.list_shares
      where list_id = briefs.list_id
        and shared_with_email = (auth.jwt() ->> 'email')
    )
  );
