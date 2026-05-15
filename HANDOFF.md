# K:CONTACTS — Claude Handoff Document
**Project directory:** `/Users/dangleyzer/Library/Mobile Documents/com~apple~CloudDocs/Documents/CLAUDE/kpop-contacts/`

---

## Current State (2026-05-15)

The Briefs feature is fully implemented (including brief indicators, filter, archival, and improved PDF hyperlink extraction). Latest commit: `99603c8` on `main`. All migrations through v4 have been run in Supabase.

**In progress (brainstorm complete, not yet implemented):** Global contacts view + brief-to-contact auto-creation. Design spec at `docs/superpowers/specs/2026-05-15-contacts-view-brief-contacts-design.md`. Implementation plan not yet written — next step is to invoke `writing-plans` on that spec.

---

## What This App Is

A desktop Electron app for K-pop A&R contacts. The user is a songwriter who pitches songs to K-pop labels. The app maintains a directory of artists, their labels, and A&R contacts. Claude auto-fills artist info and finds contacts. A new Briefs feature parses label brief PDFs and attaches structured brief data to each artist.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Shell | Electron 35 (macOS arm64) |
| UI | Single `index.html` — vanilla JS + CSS, no build step, no framework |
| Backend/Auth | Supabase (hardcoded URL + anon key in `main.js`) |
| AI | Anthropic API (`claude-sonnet-4-6`) via Supabase edge function proxy (for artist scan) and direct API call (for PDF parsing) |

**Credentials (hardcoded in `main.js` lines 57–59):**
- `SUPABASE_URL` = `https://rzjqfhioljtvhwbokbbo.supabase.co`
- `SUPABASE_ANON_KEY` = `sb_publishable_ZE15birmX4UWtUau8MUwLQ_cweDsmiz`

---

## File Structure

```
index.html                    — entire UI (~4200 lines): all HTML, CSS, JS in one file
main.js                       — Electron main process: IPC handlers, Claude API, window setup
preload.js                    — context bridge: exposes window.kc.* to renderer
db.js                         — all Supabase calls: auth, lists, artists, contacts, briefs, shares
schema.sql                    — original Supabase schema
migration_contacts.sql        — adds contacts table + RLS
migration_v2_status_notes.sql — adds status + notes_log to contacts (✅ RUN)
migration_v3_briefs.sql       — adds briefs table + RLS (✅ RUN)
HANDOFF.md                    — this file
package.json                  — electron-packager build script
dist/                         — build output
```

---

## Layout

3-column CSS grid — all columns are user-resizable (drag the borders). Widths persist in `localStorage` under `kpc-col-widths-v1`.

```
┌─────────────┬──────────────────┬──────────────────────────────────────┐
│  Sidebar    │  Artist List     │  Workspace (detail panel)            │
│  ~148px     │  ~185px          │  1fr                                 │
└─────────────┴──────────────────┴──────────────────────────────────────┘
```

---

## Briefs Feature (NEW — completed this session)

### What it does
- User clicks "Import Brief" in the app header (or drags a PDF anywhere onto the app window)
- Claude parses the PDF and extracts: label name, submission emails, and per-artist sections (deadline, general direction, track types with wants/avoids/tags, YouTube reference links)
- Artists are fuzzy-matched to existing entries (strips parentheticals like "of SHINee"); unmatched artists are auto-created
- Submission emails are matched against existing contacts; matched contact IDs stored on the brief
- Each artist gets a "Briefs" tab in the workspace alongside the existing "Contacts" tab

### How it works
**PDF parsing bypasses the Supabase proxy** (which has a 2MB body limit — a 1.3MB PDF becomes 1.7MB base64). Instead it calls Anthropic directly from `main.js` using a user-stored API key.

**The user must set their Anthropic API key in Settings → Account → Anthropic API Key.** The key is stored encrypted via Electron `safeStorage` in `~/.../userData/api-key.bin`.

### Key files and functions

**`main.js`:**
- `getStoredApiKey()` / `storeApiKey(key)` — encrypted key storage via `safeStorage`
- `callClaudeDirect(body, apiKey)` — calls `api.anthropic.com/v1/messages` directly
- `parseBriefPdf(filePath)` — reads PDF → base64 → Claude → parses JSON response
- `briefProgress(msg)` — logs to terminal AND sends `brief:progress` IPC event to renderer
- IPC handlers: `briefs:import` (dialog), `briefs:importFromPath` (drag-drop), `briefs:getAll`, `briefs:upsert`, `briefs:delete`
- `get-config` returns `{ anthropicApiKey }`, `set-config` saves it

**`preload.js`:**
- `importBriefPdf()` — triggers file dialog
- `importBriefPdfFromPath(filePath)` — used by drag-drop
- `getPathForFile(file)` — wraps `webUtils.getPathForFile()` (Electron 35 API; `file.path` is deprecated)
- `getBriefs(listId)`, `upsertBrief(listId, brief)`, `deleteBrief(briefId)`
- `onBriefProgress(cb)` — renderer listens for progress events

**`db.js`:**
- `getBriefs(listId)`, `upsertBrief(listId, brief)`, `deleteBrief(briefId)`

**`index.html`:**
- State: `let briefs = []`, `let wsTab = 'contacts'`
- `loadListArtists()` fetches briefs in same `Promise.all` as artists and contacts
- `syncBrief(brief)` — upserts to Supabase
- `normalizeBriefArtistName(name)` — strips trailing parentheticals before matching
- `matchArtistByName(rawName)` — fuzzy match against `artists[]`
- `autoCreateArtistFromBrief(rawName, label)` — creates artist if no match found
- `_processParsedBrief(parsed)` — loops artists, matches/creates, writes briefs, toasts result
- `importBriefPdf()` — button handler; sets `import-brief-btn` to "Reading brief…" while waiting
- `setBriefBtnLoading(loading)` — disables/restores the Import Brief header button
- `renderDetail()` — now includes Contacts|Briefs tab row and conditional workspace body
- `renderBriefsTab(artist)` — renders brief cards with deadline badges, track types, ref pills
- `deadlineBadgeClass(deadline)` — returns `'asap'` | `'overdue'` | `'future'` | `null`
- `selectArtist()` — resets `wsTab = 'contacts'` when switching artists
- Drag-drop: `document.addEventListener('drop', ...)` — calls `importBriefPdfFromPath` via `getPathForFile`

### Briefs data shape (Supabase `briefs` table)
```js
{
  id: uuid,
  list_id: uuid,
  artist_id: uuid,
  source_pdf: string,           // filename e.g. "2026.05 SM LEAD.pdf"
  label: string,                // e.g. "SM Entertainment"
  deadline: string | null,      // as-is from PDF: "ASAP", "By May 8th", null
  general_direction: string | null,
  track_types: [{
    name: string,
    tags: string[],             // hashtags from heading e.g. "#GenZ_Energy"
    wants: string[],
    avoids: string[],
    references: [{ title: string, url: string }]
  }],
  submission_emails: string[],
  matched_contact_ids: uuid[],
  created_at: timestamptz
}
```

### Deadline badge colors
- `ASAP` or unparseable string → yellow
- Parsed date in the past → red
- Parsed date in the future → green
- No deadline → no badge

---

## Data Model

### JS State Globals
```js
let artists = []              // all artists for current list
let contacts = []             // all contacts for current list
let briefs = []               // active (non-archived) briefs for current list
let archivedBriefs = []       // archived but not yet deleted briefs
let lists = []
let currentListId = null
let currentListRole = null    // 'owner' | 'editor' | 'viewer'
let selectedId = null         // selected artist id
let selectedContactId = null  // selected contact id (notes panel)
let wsTab = 'contacts'        // 'contacts' | 'briefs'
let activeLabel = 'all'
let sortMode = 'name'
let searchQuery = ''
let wsStatusFilter = 'all'
let briefFilterActive = false // filter artist list to artists with active briefs
let archivedExpanded = false  // expand archived briefs section in briefs tab
let contactsViewActive = false  // PLANNED: switches middle col to contacts list
let contactEditMode = false     // PLANNED: contact panel edit vs read-only
```

### Contact Record Shape
```js
{
  id: uuid,
  list_id: uuid,
  label: string,
  artist_ids: uuid[],
  name, role, email, phone, social: string,
  extra_emails: string[],       // PLANNED (migration_v5): additional emails
  status: 'cold' | 'reached_out' | 'in_convo' | 'placed',
  notes_log: [{ date: 'YYYY-MM-DD', text: string }]
}
```

---

## Key Gotchas

- **Anthropic API key required for PDF import.** Without it, `parseBriefPdf` falls back to the Supabase proxy, which will 503 on any real brief PDF (payload too large). Key goes in Settings → Account.
- **`webUtils.getPathForFile(file)` not `file.path`** — Electron 35 removed `file.path` for drag-drop files. Always use `window.kc.getPathForFile(file)` in the renderer.
- **`window.prompt()` is silently blocked** in Electron 35 with `contextIsolation: true` — all prompts use custom `showPrompt()` modal.
- **`<button>` elements on macOS** get white default background without `background: transparent; -webkit-appearance: none`.
- **`normalizeLabel()` is used for filtering** — `activeLabel` always holds the normalized name.
- **Column resizer** uses absolutely-positioned handles inside `.app`. JS sets `gridTemplateColumns` directly on `.app.style`. Widths persist in localStorage.
- **Always use `h()` for user data in innerHTML** — all brief content (from Claude) goes through `h()`.
- **`status` values** must be whitelisted before use as CSS class: `['cold','reached_out','in_convo','placed']`.
- **Brief reference pill URLs** are validated to start with `https://` or `http://` before rendering as links.
- **Toast z-index is 9999** — above all overlays including settings panel.
- **`max_tokens: 8192`** for PDF parsing — 4096 was too low and truncated large briefs mid-JSON.

---

## Database Schema (Supabase)

- **`lists`** — user-owned lists (id, owner_id, name, created_at)
- **`artists`** — JSONB data store (id, list_id, data, updated_at)
- **`contacts`** — (id, list_id, label, artist_ids, name, role, email, phone, social, status, notes_log, created_at, updated_at) + `extra_emails jsonb` PLANNED (migration_v5)
- **`briefs`** — (id, list_id, artist_id, source_pdf, label, deadline, general_direction, track_types jsonb, submission_emails text[], matched_contact_ids uuid[], archived_at timestamptz, created_at)
- **`list_shares`** — (list_id, shared_with_email, role)
- **`share_tokens`** — (id, list_id, role, created_by)

All tables have RLS. Briefs RLS mirrors artists: owner full access, editors read/write, viewers read.

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

## Briefs Feature — Archival System (completed 2026-05-14)

Brief archival runs automatically on each `loadListArtists()` call:

- `shouldArchive(brief)` — returns true if: deadline is past, or brief is ASAP/no-deadline and `created_at` > 30 days ago
- Archival pass stamps `archived_at` on newly-expired briefs (fire-and-forget upsert), deletes briefs where `archived_at` > 60 days ago
- `briefs[]` = active only; `archivedBriefs[]` = archived but not deleted
- Briefs tab shows collapsible "Archived (N)" section (global `archivedExpanded` flag, resets on artist select)
- `briefFilterActive` — toggle button in artist list header; resets on list switch
- Purple glow dot on artist avatars that have active briefs
- Brief ref-pills now use `data-action="open-url"` delegation (no inline onclick)

## Brief PDF Parsing — Hyperlink Extraction (completed 2026-05-15)

`extractPdfUris(buffer)` in `main.js` reads raw PDF bytes for `/URI` annotation metadata (music URLs invisible to text reading), filters to music hosts (Spotify, YouTube, SoundCloud, disco.ac, untitled.stream, somespecialmagic.com), and injects them into the Claude prompt as hints so Claude can match URLs to reference entries.

Ref-pills with title but no URL render as dimmed non-clickable `.ref-pill-nourl` spans (not silently dropped).

## Next Feature — Contacts View & Brief Contacts (designed 2026-05-15, NOT YET IMPLEMENTED)

**Design spec:** `docs/superpowers/specs/2026-05-15-contacts-view-brief-contacts-design.md`

**Next action:** Invoke `writing-plans` on that spec to create an implementation plan, then implement with subagent-driven development.

**Summary of what's designed:**

1. **Global Contacts View** — sidebar footer "All Contacts" button switches middle column to flat contact list. Label filter still applies. ⌘F / search bar filters contacts (by name, role, email, label) when in this mode. Clicking a contact shows the notes panel in the right column with a read-only "Artists: X, Y" line at top.

2. **Read-only contact panel (everywhere)** — `renderNotesPanel` defaults to read-only display. `✎ Edit` button enables input fields; `✓ Done` saves and returns to read-only. Applies in both global contacts view AND within artist workspace. Global flag: `contactEditMode`.

3. **Extra emails** — contacts gain `extra_emails: string[]` (migration_v5). When a brief contact matches by name but has a different email, the new email is added to `extra_emails` instead of overwriting. Deduplication checks `email` + all `extra_emails`. UI shows all email lines in panel; edit mode allows adding/removing.

4. **Brief → contact auto-creation** — brief parsing prompt gains top-level `contacts: [{name, email, role}]`. In `_processParsedBrief`, for each: email-only → create if email not seen; name+email → check email first (skip if found), then check name (add email if found without it), else create new. New contacts get `artist_ids` of all artists in that brief, `label` from brief, `status: 'cold'`.

**Migration needed (user must run in Supabase):**
```sql
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS extra_emails jsonb NOT NULL DEFAULT '[]';
```

## Suggested Next Steps

- **Implement contacts view + brief contacts** — spec is written, just needs plan + implementation
- **CSV export** of contacts for an artist or label
- **Add more label normalizations** to `LABEL_NORMALIZE_MAP` as new variants appear
- **Brief status tracking** — mark a brief as "pitched" or "passed"
- **Delete brief** — UI to remove a brief card (IPC handler exists, no UI trigger yet)
