# K:CONTACTS — Claude Handoff Document
**Project directory:** `/Users/dangleyzer/Library/Mobile Documents/com~apple~CloudDocs/Documents/CLAUDE/kpop-contacts/`

---

## Current State (2026-05-14)

The v1.1 redesign is complete and all UI polish from the post-redesign session is done. Latest commit: `bee96b7` — resizable columns.

---

## What This App Is

A desktop Electron app for K-pop A&R contacts. The user is a songwriter who pitches songs to K-pop labels. The app lets them maintain a directory of artists, the labels they're signed to, and the A&R contacts at those labels. Claude (via Anthropic API + web search) auto-fills artist info and finds contact details.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Shell | Electron 35 (macOS arm64) |
| UI | Single `index.html` — vanilla JS + CSS, no build step, no framework |
| Backend/Auth | Supabase (hardcoded URL + anon key in `main.js`) |
| AI | Anthropic API (`claude-sonnet-4-6` + `web_search_20250305` hosted tool) |
| Fonts | Montserrat (Google Fonts, loads at runtime), Space Mono, system fallbacks |

**Credentials (hardcoded in `main.js` lines 57–59):**
- `SUPABASE_URL` = `https://rzjqfhioljtvhwbokbbo.supabase.co`
- `SUPABASE_ANON_KEY` = `sb_publishable_ZE15birmX4UWtUau8MUwLQ_cweDsmiz`

---

## File Structure

```
index.html           — entire UI (3800+ lines): all HTML, CSS, and JS in one file
main.js              — Electron main process: IPC handlers, Claude API calls, window setup
preload.js           — context bridge: exposes window.kc.* to renderer
db.js                — all Supabase calls: auth, lists, artists, contacts, shares, tokens, realtime
schema.sql           — original Supabase schema (run once to set up)
migration_contacts.sql      — adds contacts table + RLS + realtime (run once)
migration_v2_status_notes.sql — adds status + notes_log columns to contacts (⚠️ NOT YET RUN)
HANDOFF.md           — this file
package.json         — electron-packager build script
dist/                — build output
```

---

## Layout

3-column CSS grid — **all columns are user-resizable** (drag the borders):

```
┌─────────────┬──────────────────┬──────────────────────────────────────┐
│  Sidebar    │  Artist List     │  Workspace (detail panel)            │
│  ~148px     │  ~185px          │  1fr                                 │
└─────────────┴──────────────────┴──────────────────────────────────────┘
```

Column widths are persisted in localStorage under `kpc-col-widths-v1`. Minimums: 80px sidebar, 100px artist list.

---

## UI Design (v1.1)

### Sidebar
- Black background (`var(--bg)`)
- "Labels" section header + list of normalized label names with artist counts
- Clicking a label filters the artist list; active item highlights pink
- Label names are normalized — variants like "BIGHIT MUSIC (HYBE)" and "Big Hit Music" both show as "BIGHIT"
- Parent-company parentheticals like "(HYBE)" are stripped automatically

### Artist List Column
- Bare compact rows — no column title, no search/filter bar
- Each row: colored avatar bubble (label initial + label gradient) · artist name · status dot
- Avatar shows the LABEL's first letter (B=BIGHIT, S=SM, Y=YG, J=JYP, etc.) in a gradient derived from the label's dot color
- Status dot color = highest-priority contact status for that artist
- No label name text in the row (label communicated by avatar color+letter)

### Workspace (Detail Panel)
- Artist header: name + label (accent color) + contact count
- Status filter pills: All / Cold / Reached Out / In Convo / Placed
- Compact contact table: # · Name · Role · Email · Status · hover actions
- Double-click a contact row → opens 240px Notes Panel on the right
- Notes panel: inline editing of all fields, status dots, quick actions (Email/Copy/DM), append-only notes log

### Header
- Logo, list name, back button, share button, Add Artist button (primary), Settings
- Import button removed — Add Artist modal has a Bulk Import tab

---

## Data Model

### JS State Globals
```js
let artists = []          // all artists for current list
let contacts = []         // all contacts for current list
let lists = []
let currentListId = null
let currentListRole = null  // 'owner' | 'editor' | 'viewer'
let selectedId = null       // selected artist id
let activeLabel = 'all'     // sidebar filter (normalized label name)
let sortMode = 'name'       // 'name' | 'date' | 'label' | 'custom'
let searchQuery = ''
```

### Contact Record Shape
```js
{
  id: uuid,
  list_id: uuid,
  label: string,           // raw label string from artist
  artist_ids: uuid[],      // artists this contact covers; [] = label-wide
  name, role, email, phone, social: string,
  status: 'cold' | 'reached_out' | 'in_convo' | 'placed',
  notes_log: [{ date: 'YYYY-MM-DD', text: string }]  // append-only
}
```

### Label System
- `LABEL_MAP` — maps keyword arrays to `{ cls, dot }` for color styling
- `LABEL_NORMALIZE_MAP` — maps raw label string variants to canonical display names
- `normalizeLabel(label)` — strips trailing parentheticals, looks up map, falls back to abbreviating "Entertainment" → "Ent."
- `avatarGradient(hexColor)` — derives a `linear-gradient(135deg, dark, mid)` from a dot color using 0.28× and 0.58× multipliers

---

## Key Gotchas

- **`window.prompt()` is silently blocked** in Electron 35 with `contextIsolation: true` — all prompts use custom `showPrompt()` modal
- **`<button>` elements on macOS** get white default background without `background: transparent; -webkit-appearance: none` — all `.artist-row` buttons need this
- **`normalizeLabel()` is used for filtering** — `activeLabel` always holds the normalized name, and `getFiltered()` compares `normalizeLabel(a.label)` against it. Don't compare raw `a.label` to `activeLabel`.
- **Column resizer** uses absolutely-positioned handles inside `.app` (which has `position: relative`). They're not grid children — they overlay the borders. JS sets `gridTemplateColumns` directly on `.app.style`.
- **`initials()`** returns a single character: `name.trim().charAt(0)`. Do not change to multi-char.
- **`upsertContact` in `db.js`** spreads all fields — no db.js changes needed for new contact fields
- **`status` values** must be whitelisted before use as CSS class: `['cold','reached_out','in_convo','placed']`
- **Action buttons** in notes panel use `data-action`/`data-value` (not inline onclick) to prevent XSS
- Always use `h()` for user data in innerHTML

---

## ⚠️ Pending: Supabase Migration

`migration_v2_status_notes.sql` adds `status` and `notes_log` columns to the `contacts` table. **This has never been run.** Contact status tracking and notes log are non-functional until this migration is applied.

Run it in the Supabase SQL Editor at: `https://rzjqfhioljtvhwbokbbo.supabase.co`

---

## Database Schema (Supabase)

- **`lists`** — user-owned contact lists (id, owner_id, name, created_at)
- **`artists`** — one row per artist, data stored as JSONB (id, list_id, data, updated_at)
- **`contacts`** — standalone contacts table (id, list_id, label, artist_ids uuid[], name, role, email, phone, social, notes, **status**, **notes_log**, created_at, updated_at)
  - `status` and `notes_log` columns require migration_v2_status_notes.sql
- **`list_shares`** — share a list with another user by email (viewer/editor role)
- **`share_tokens`** — UUID tokens for invite links

---

## Build & Run

```bash
npm start          # run locally
npm run pack       # build .app → dist/K-CONTACTS-darwin-arm64/K-CONTACTS.app
```

**Install for others (macOS, no code signing):**
1. Drag app to `/Applications`
2. `sudo xattr -cr /Applications/K-CONTACTS.app`
3. Open app

---

## Suggested Next Steps

1. **Run `migration_v2_status_notes.sql`** in Supabase SQL Editor — unblocks status + notes log
2. **Test contact flow** end-to-end after migration
3. **CSV export** of contacts for an artist or label
4. **Add more label normalizations** to `LABEL_NORMALIZE_MAP` as new label variants appear in real data
