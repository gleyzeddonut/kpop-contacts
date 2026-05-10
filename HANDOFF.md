# K:CONTACTS — Claude Handoff Document
**Project directory:** `/Users/dangleyzer/Library/Mobile Documents/com~apple~CloudDocs/Documents/CLAUDE/kpop-contacts/`

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
index.html           — entire UI (3700+ lines): all HTML, CSS, and JS in one file
main.js              — Electron main process: IPC handlers, Claude API calls, window setup
preload.js           — context bridge: exposes window.kc.* to renderer
db.js                — all Supabase calls: auth, lists, artists, contacts, shares, tokens, realtime
schema.sql           — original Supabase schema (run once to set up)
migration_contacts.sql — NEW: run this to add the contacts table + RLS + realtime
HANDOFF.md           — this file
package.json         — electron-packager build script
dist/                — build output (K-CONTACTS.dmg, K-CONTACTS-darwin-arm64/)
```

---

## Database Schema (Supabase)

- **`lists`** — user-owned contact lists (id, owner_id, name, created_at)
- **`artists`** — one row per artist, data stored as JSONB (id, list_id, data, updated_at)
- **`contacts`** — NEW: standalone contacts table (id, list_id, label, artist_ids uuid[], name, role, email, phone, social, notes, created_at, updated_at)
- **`list_shares`** — share a list with another user by email (viewer/editor role)
- **`share_tokens`** — UUID tokens for invite links that resolve to list_shares
- RLS enabled on all tables. Helper function `auth_is_list_owner()` avoids recursion.

### IMPORTANT: Run migration_contacts.sql in Supabase
The `contacts` table MUST be created before the app can store contacts. Run `migration_contacts.sql` in the Supabase SQL Editor.

---

## App Architecture

**Layout:** 3-column CSS grid: `sidebar (210px) | main list (1fr) | detail panel (380px)`

**Two view modes inside main:**
- **Artists view** — scrollable list of artist cards + right-side detail panel
- **Labels view** — two-panel directory: label navigator left (220px) | contacts right (1fr). Grid switches via `.app.view-labels` class.

**State (all in index.html JS globals):**
```js
let artists = []          // all artists for current list
let contacts = []         // all contacts for current list (from contacts table)
let lists = []            // all user lists
let currentListId = null
let currentListRole = null // 'owner' | 'editor' | 'viewer'
let selectedId = null     // selected artist id
let activeLabel = 'all'   // sidebar filter
let listView = 'artists'  // 'artists' | 'labels'
let selectedLabelName = null // selected label in labels view
let sortMode = 'name'     // 'name' | 'date' | 'label' | 'custom'
let searchQuery = ''
let expandedNotes = new Set()
```

**Contact data model:**
```js
{
  id: uuid,
  list_id: uuid,     // Supabase FK
  label: string,     // e.g. "HYBE / Big Hit Music" — matches artist.label
  artist_ids: uuid[], // which artists this contact covers; [] = label-wide
  name, role, email, phone, social, notes: string
}
```

**IPC bridge pattern:** `main.js` → ipcMain.handle → `preload.js` contextBridge → `window.kc.*` → `index.html`

---

## Features Implemented

### Auth
- Sign up / sign in / sign out / reset password
- Email confirmation via custom deep link: `kcontacts://auth/confirm?code=xxx` (PKCE flow)
- Auth errors mapped to human-friendly messages by Supabase error `.code` field
- Session persisted to `sb-session.json` in userData

### Lists
- Create / rename / delete lists
- Dashboard overlay shows all lists (owned + shared) on startup
- Share lists with other users by email (viewer/editor roles)
- Shareable invite links via UUID tokens (`kcontacts://share/{uuid}`)

### Artists
- Add via Auto-Fill (Claude scans web), Bulk Import (textarea, one name per line), or Manual
- Duplicate detection on add (case-insensitive name match)
- Edit / delete artist
- "Scan Web" button re-scans contacts for an artist
- Sort by name / date / label / custom drag order
- Scan queue: processes one at a time, 20s gap between scans, 60s retry on rate limit
- Artist cards show contact count from `contacts[]` state

### Contacts (Option B — first-class table)
- Contacts live in `contacts` Supabase table, not embedded in artist JSONB
- Each contact has `label` + `artist_ids[]` for multi-artist/label-wide contacts
- Adding contacts: from artist detail panel (pre-assigns artist), from labels panel header (label-wide), from artist tags (+)
- Contact modal shows checkboxes for all artists in the same label (for assignment)
- Migration: `migrateEmbeddedContacts()` runs on list open and migrates any artist with old embedded contacts
- Realtime: contacts table has its own Supabase realtime subscription

### Labels View
- Two-panel directory: labels nav on left, contacts panel on right
- `buildLabelMap()` groups artists by label, contacts by `contact.label` field
- Contact cards show "via [artist names]" from `artist_ids` lookup; empty = "label-wide"
- Edit button on each contact card in labels view
- "Add" button in labels panel header (label-wide)
- "+" on artist tags (artist-specific)
- Delete button on hover

### UI Details
- Dark theme: `--bg: #09090E`, `--accent: #FF2D78` (pink)
- Notes accordion: collapsed by default, `expandedNotes` Set (presence = expanded)
- Contact assignment: toggle-style checkboxes in contact modal (`.contact-artist-check` with CSS `:has(input:checked)`)

---

## Build & Distribution

**Run locally:**
```bash
npm start
```

**Build .app:**
```bash
npm run pack
# outputs to dist/K-CONTACTS-darwin-arm64/K-CONTACTS.app
```

**Build DMG:**
```bash
# See previous sessions — uses hdiutil create with staged folder
```

**Critical:** The `--ignore` flag in package.json pack script is `'^/dist'` (anchored regex).

**Install for others (macOS, no code signing):**
1. Drag app to `/Applications`
2. `sudo xattr -cr /Applications/K-CONTACTS.app`
3. Open app

---

## Gotchas / Non-Obvious Decisions

- **`window.prompt()` is silently blocked** in Electron 35 with `contextIsolation: true`. All prompts use custom `showPrompt()` modal.
- **Rate limit:** Anthropic web search = 30k input tokens/min. Mitigated with `max_uses: 2` per scan, 20s gap, 60s retry.
- **Labels view grid:** When `.app.view-labels` is set, `main.artist-list` switches to `display: grid; grid-template-columns: 220px 1fr`.
- **`auth_is_list_owner()` function** in schema: prevents infinite recursion in RLS policies.
- **`contacts[]` state** is always the source of truth for rendering. `a.contacts` on artist objects is legacy and should be empty after migration.
- **`migrateEmbeddedContacts()`** is idempotent — safe to call multiple times.
- **Local mode** uses `kpc-contacts-v1` localStorage key for contacts (separate from `kpc-v5` for artists).

---

## Suggested Next Steps

1. **Run migration_contacts.sql** in Supabase SQL Editor
2. **Test contact flow** — add contact from artist view, from label view (label-wide), from artist tag (+)
3. **Export** — CSV export of contacts
4. **Intel Mac build** — add `--arch=all` to pack script
5. **Build and ship v1.0.5** with this contacts migration
