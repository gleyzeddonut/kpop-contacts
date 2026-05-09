-- K:CONTACTS Supabase Schema
-- Run this entire file in your Supabase project's SQL Editor

-- ── LISTS ─────────────────────────────────────────────────────────────────
create table public.lists (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references auth.users(id) on delete cascade not null,
  name        text not null default 'My List',
  created_at  timestamptz default now()
);

-- ── ARTISTS ───────────────────────────────────────────────────────────────
-- Each artist (with embedded contacts) is one row; data stored as JSONB
create table public.artists (
  id          uuid primary key,
  list_id     uuid references public.lists(id) on delete cascade not null,
  data        jsonb not null,
  updated_at  timestamptz default now()
);

-- ── LIST SHARES ───────────────────────────────────────────────────────────
create table public.list_shares (
  id                  uuid primary key default gen_random_uuid(),
  list_id             uuid references public.lists(id) on delete cascade not null,
  shared_with_email   text not null,
  role                text check (role in ('viewer', 'editor')) not null default 'viewer',
  created_at          timestamptz default now(),
  unique (list_id, shared_with_email)
);

-- ── SHARE TOKENS ─────────────────────────────────────────────────────────
-- Each row is a shareable invite link with a role. Resolving the token adds
-- the opening user to list_shares.
create table public.share_tokens (
  id         uuid primary key default gen_random_uuid(),
  list_id    uuid references public.lists(id) on delete cascade not null,
  role       text check (role in ('viewer', 'editor')) not null default 'viewer',
  created_by uuid references auth.users(id) on delete cascade not null,
  created_at timestamptz default now()
);

-- ── ROW LEVEL SECURITY ────────────────────────────────────────────────────
alter table public.lists       enable row level security;
alter table public.artists     enable row level security;
alter table public.list_shares enable row level security;

-- Helper: check list ownership without triggering RLS (avoids infinite recursion
-- between the lists↔list_shares cross-referencing policies)
create or replace function auth_is_list_owner(p_list_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.lists where id = p_list_id and owner_id = auth.uid()
  );
$$;

-- Lists: owner
create policy "owner full access"
  on public.lists for all
  using  (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Lists: shared users can read
create policy "shared users can view list"
  on public.lists for select
  using (
    exists (
      select 1 from public.list_shares
      where list_id = lists.id
        and shared_with_email = (auth.jwt() ->> 'email')
    )
  );

-- Artists: owner of the list
create policy "list owner full access"
  on public.artists for all
  using (
    exists (select 1 from public.lists where id = artists.list_id and owner_id = auth.uid())
  )
  with check (
    exists (select 1 from public.lists where id = artists.list_id and owner_id = auth.uid())
  );

-- Artists: editors can read and write
create policy "editors can read and write artists"
  on public.artists for all
  using (
    exists (
      select 1 from public.list_shares
      where list_id = artists.list_id
        and shared_with_email = (auth.jwt() ->> 'email')
        and role = 'editor'
    )
  )
  with check (
    exists (
      select 1 from public.list_shares
      where list_id = artists.list_id
        and shared_with_email = (auth.jwt() ->> 'email')
        and role = 'editor'
    )
  );

-- Artists: viewers can only read
create policy "viewers can read artists"
  on public.artists for select
  using (
    exists (
      select 1 from public.list_shares
      where list_id = artists.list_id
        and shared_with_email = (auth.jwt() ->> 'email')
    )
  );

-- Shares: owners manage their list's shares
-- Uses auth_is_list_owner() to avoid recursion with the lists↔list_shares policies
create policy "owner manages shares"
  on public.list_shares for all
  using (auth_is_list_owner(list_id))
  with check (auth_is_list_owner(list_id));

-- Shares: shared users can read their own share row
create policy "shared user can see own share"
  on public.list_shares for select
  using (shared_with_email = (auth.jwt() ->> 'email'));

-- Share tokens RLS
alter table public.share_tokens enable row level security;

-- Only list owners can create/view/delete their tokens
create policy "owner manages tokens"
  on public.share_tokens for all
  using (auth_is_list_owner(list_id))
  with check (auth_is_list_owner(list_id));

-- Any signed-in user can read a token to resolve it
create policy "authenticated can read token"
  on public.share_tokens for select
  using (auth.uid() is not null);
