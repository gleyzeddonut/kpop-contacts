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
- `ANTHROPIC_API_KEY` = in main.js line 59

---

## File Structure

```
index.html      — entire UI (3600+ lines): all HTML, CSS, and JS in one file
main.js         — Electron main process: IPC handlers, Claude API calls, window setup
preload.js      — context bridge: exposes window.kc.* to renderer
db.js           — all Supabase calls: auth, lists, artists, shares, tokens, realtime
schema.sql      — Supabase schema (run once in Supabase SQL editor to set up)
package.json    — electron-packager build script
dist/           — build output (K-CONTACTS.dmg, K-CONTACTS-darwin-arm64/)
```

---

## Database Schema (Supabase)

- **`lists`** — user-owned contact lists (id, owner_id, name, created_at)
- **`artists`** — one row per artist, data stored as JSONB (id, list_id, data, updated_at)
- **`list_shares`** — share a list with another user by email (viewer/editor role)
- **`share_tokens`** — UUID tokens for invite links that resolve to list_shares
- RLS enabled on all tables. Helper function `auth_is_list_owner()` avoids recursion.

---

## App Architecture

**Layout:** 3-column CSS grid: `sidebar (210px) | main list (1fr) | detail panel (380px)`

**Two view modes inside main:**
- **Artists view** — scrollable list of artist cards + right-side detail panel
- **Labels view** — two-panel directory: label navigator left (220px) | contacts right (1fr). Grid switches via `.app.view-labels` class.

**State (all in index.html JS globals):**
```js
let artists = []          // all artists for current list
let lists = []            // all user lists
let currentListId = null
let currentListRole = null // 'owner' | 'editor' | 'viewer'
let selectedId = null     // selected artist id
let activeLabel = 'all'   // sidebar filter
let listView = 'artists'  // 'artists' | 'labels'
let selectedLabelName = null // selected label in labels view
let sortMode = 'name'     // 'name' | 'date' | 'label' | 'custom'
let searchQuery = ''
let collapsedNotes = new Set()
```

**Sort/order persistence:** `localStorage` keyed by `kpc-sort-${listId}` and `kpc-order-${listId}`.

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

### Labels View
- Two-panel directory: labels nav on left, contacts panel on right
- Auto-selects first label on view switch
- `buildLabelMap()` aggregates contacts across all artists per label, deduplicates by name+role
- Contact rows show name, role badge, "via [artist]", email/phone/social with copy buttons
- Colored left stripe on contact cards matches the label's color

### UI Details
- Dark theme: `--bg: #09090E`, `--accent: #FF2D78` (pink)
- Fonts: `--font-display` = Montserrat (UI), `--font-mono` = Space Mono, `--font-name` = Apercu Bold → Montserrat (names)
- Artist cards have a colored left border stripe matching their label color
- Label colors: deterministic from label name string → one of 8 preset color palettes
- Notes section in detail panel: accordion card (toggle header + content are one unified card)
- Detail panel header: name left + initials avatar right, aligned to bottom edge
- Prompt modal (replaces `window.prompt()` which Electron 35 silently blocks)
- Confirm overlay for destructive actions
- Toast notifications

### Realtime
- Supabase realtime subscription per list
- Artist changes (insert/update/delete) from other users sync live

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
See the hdiutil commands used previously — stages app + INSTALL.txt + Applications symlink into a temp folder then `hdiutil create -format UDZO`.

**Critical:** The `--ignore` flag in package.json pack script is `'^/dist'` (anchored regex). If it were just `dist` it would strip `/dist` from every node_module (broke supabase-js in v1 of the DMG).

**Install for others (macOS, no code signing):**
1. Drag app to `/Applications`
2. `sudo xattr -cr /Applications/K-CONTACTS.app`
3. Open app

**Note:** Build is arm64 only (M-series Macs). For Intel Macs, need `--arch=x64` or `--arch=all`.

---

## Known Issues / Not Yet Done

- **Auto-update:** No in-app update mechanism. Users need a new DMG each release. Was discussed — plan was to add a version check endpoint + in-app notification banner. Not implemented yet.
- **Fonts:** Apercu Bold and Gotham are commercial fonts not installed on the user's system. App falls back to Montserrat. User wanted to try these — they need license files to actually install them (`~/Library/Fonts/`).
- **Intel Mac support:** Current build is arm64 only.
- **Windows:** Not built/tested.
- **Email confirm redirect:** User must add `kcontacts://auth/confirm` to Supabase Auth → URL Configuration → Redirect URLs whitelist (one-time setup in Supabase dashboard).
- **`.command` install script:** Was replaced with `INSTALL.txt` because macOS quarantines `.command` files from DMGs and they silently fail on double-click.

---

## Gotchas / Non-Obvious Decisions

- **`window.prompt()` is silently blocked** in Electron 35 with `contextIsolation: true`. All prompts use a custom `showPrompt()` modal (`#prompt-overlay`, z-index 500).
- **`onclick` with `JSON.stringify`** in innerHTML must use single-quote attribute delimiters (`onclick='selectLabel(...)'`) because `JSON.stringify` wraps strings in double quotes.
- **Rate limit:** Anthropic web search = 30k input tokens/min. Mitigated with `max_uses: 2` per scan, 20s gap between queued scans, 60s retry on rate limit error. Queue uses peek-not-pop (item stays at front until success).
- **Supabase `getArtists`** orders by `updated_at DESC` (newest first).
- **Labels view grid:** When `.app.view-labels` is set, `main.artist-list` switches to `display: grid; grid-template-columns: 220px 1fr`. `#artist-cards` must be `display: none` or it occupies the first grid slot and breaks the layout.
- **`auth_is_list_owner()` function** in schema: prevents infinite recursion in RLS policies when lists and list_shares cross-reference each other.

---

## Suggested Next Steps

1. **In-app update notifications** — fetch a `version.json` from GitHub/Supabase Storage on startup, show banner if newer version available with download link
2. **Contact editing** — currently contacts are added via AI scan only; no way to manually add/edit individual contacts in the detail panel
3. **Export** — CSV export of contacts for a label or list
4. **Intel Mac build** — add `--arch=all` to pack script for universal binary
5. **Notes in artist cards** — currently notes only show in detail panel; could surface a snippet in the card
