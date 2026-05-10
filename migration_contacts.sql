-- K:CONTACTS — Migration: contacts as first-class table
-- Run this in your Supabase SQL Editor

-- ── CONTACTS TABLE ────────────────────────────────────────────────────────
create table if not exists public.contacts (
  id          uuid primary key default gen_random_uuid(),
  list_id     uuid references public.lists(id) on delete cascade not null,
  label       text not null default '',
  artist_ids  uuid[] not null default '{}',
  name        text not null default '',
  role        text not null default '',
  email       text not null default '',
  phone       text not null default '',
  social      text not null default '',
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.contacts enable row level security;

-- Owner: full CRUD
create policy "list owner full access on contacts"
  on public.contacts for all
  using (
    exists (select 1 from public.lists where id = contacts.list_id and owner_id = auth.uid())
  )
  with check (
    exists (select 1 from public.lists where id = contacts.list_id and owner_id = auth.uid())
  );

-- Editors: full CRUD
create policy "editors can read and write contacts"
  on public.contacts for all
  using (
    exists (
      select 1 from public.list_shares
      where list_id = contacts.list_id
        and shared_with_email = (auth.jwt() ->> 'email')
        and role = 'editor'
    )
  )
  with check (
    exists (
      select 1 from public.list_shares
      where list_id = contacts.list_id
        and shared_with_email = (auth.jwt() ->> 'email')
        and role = 'editor'
    )
  );

-- Viewers: SELECT only
create policy "viewers can read contacts"
  on public.contacts for select
  using (
    exists (
      select 1 from public.list_shares
      where list_id = contacts.list_id
        and shared_with_email = (auth.jwt() ->> 'email')
    )
  );

-- Enable realtime for contacts table
-- (Run in Supabase Dashboard → Database → Replication → Supabase Realtime → add contacts)
-- Or run: alter publication supabase_realtime add table public.contacts;
alter publication supabase_realtime add table public.contacts;
