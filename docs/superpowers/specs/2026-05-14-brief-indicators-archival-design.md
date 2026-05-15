# Brief Indicators, Filter, and Archival Design

**Goal:** Make artists with active briefs visually distinct in the list, add a filter to show only those artists, and automatically archive/expire old briefs.

**Architecture:** Client-side archival pass on each list load; DB-backed `archived_at` timestamp for stable deletion countdown; purple glowing dot on avatar; toggle button in artist list header.

**Tech Stack:** Vanilla JS in `index.html`, Supabase (`briefs` table), one SQL migration.

---

## 1. Artist List Indicators

A small glowing purple dot appears on the top-right corner of the avatar for any artist that has at least one active (non-archived) brief.

- "Active brief" = a brief where `archived_at IS NULL`
- The dot is rendered inside the `renderList()` function in `index.html`
- Uses `briefs` state array (which, after this feature, will contain only non-archived briefs — see Section 3)
- CSS: absolute-positioned circle, `background: #a855f7`, `box-shadow: 0 0 5px rgba(168,85,247,0.7)`, `border: 1.5px solid` the app background color to create separation from the avatar

## 2. Active Briefs Filter

A toggle button sits in the artist list column header, left side (sort button stays on the right).

- State: `let briefFilterActive = false` (global, alongside `activeLabel`, `searchQuery`)
- When toggled on: button renders highlighted (purple tint background, purple border/text); `getFiltered()` additionally filters out artists with no active briefs
- When toggled off: button renders as gray/inactive; filter has no effect
- The filter **stacks** with `activeLabel` — both conditions must be met simultaneously
- On list switch (`loadListArtists`), `briefFilterActive` resets to `false`
- Button label: "Briefs" with a small document icon; no count shown

## 3. Archival Rules

### Schema change

Migration adds one nullable column to `briefs`:

```sql
ALTER TABLE briefs ADD COLUMN archived_at timestamptz NULL;
```

### Archival thresholds

A brief should be archived when any of the following is true:
- Its `deadline` field parses to a date in the past (reuse `deadlineBadgeClass` logic: strip "By ", parse, check `< new Date()`)
- Its `deadline` is "ASAP", unparseable, or null — **and** `created_at` is more than 1 month ago

A brief should be **deleted** when:
- `archived_at` is set and is more than 2 months ago

### Archival pass

Runs in `loadListArtists()` immediately after briefs are fetched, before state is assigned.

```
for each brief in fetched briefs:
  if archived_at is set and archived_at < (now - 2 months):
    → call deleteBrief(brief.id)  [fire and forget]
    → remove from array
  else if archived_at is null and brief meets archive threshold:
    → call upsertBrief(listId, { ...brief, archived_at: now.toISOString() })
    → set brief.archived_at = now locally
```

After the pass:
- `briefs = fetched.filter(b => !b.archived_at)` — only active briefs
- `archivedBriefs = fetched.filter(b => b.archived_at && !shouldDelete(b))` — archived-but-not-deleted

Both arrays are module-level globals.

### Helper: shouldArchive(brief)

```js
function shouldArchive(brief) {
  if (!brief.deadline) {
    return new Date(brief.created_at) < new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  }
  const d = brief.deadline.toUpperCase();
  if (d.includes('ASAP')) {
    return new Date(brief.created_at) < new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  }
  const parsed = new Date(brief.deadline.replace(/By\s*/i, '').trim());
  if (!isNaN(parsed)) return parsed < new Date();
  // Unparseable string — treat like ASAP
  return new Date(brief.created_at) < new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
}
```

## 4. Archived Briefs UI

In the artist's Briefs tab (`renderBriefsTab`):

1. Active briefs render at the top exactly as they do today
2. If `archivedBriefs` contains any entries for this artist, render a collapsible section below:
   - Header: `"Archived (N)"` — clicking toggles expansion (global `let archivedExpanded = false`, reset to `false` in `selectArtist()` alongside `wsTab`)
   - When expanded: archived brief cards render identically to active ones **except**:
     - The card is dimmed (`opacity: 0.5`)
     - Instead of a deadline badge, show a small gray `"Archived [date]"` label (e.g., "Archived May 2")
     - No interaction changes — purely a read view

## 5. Data Flow Summary

```
loadListArtists()
  → fetch artists, contacts, briefs in parallel
  → run archival pass on briefs (delete expired, stamp newly archived)
  → briefs = active only
  → archivedBriefs = archived, not deleted
  → render()

renderList()
  → for each artist: check if briefs[] has any entry with artist_id === a.id
  → if yes: render glow dot on avatar
  → if briefFilterActive: skip artists with no active briefs

renderBriefsTab(artist)
  → active briefs from briefs[]
  → archived briefs from archivedBriefs[]
  → show archived section if any exist

getFiltered()
  → existing label + search filter
  → if briefFilterActive: also filter to artists with active briefs
```

## 6. Files Changed

| File | Change |
|---|---|
| `migration_v4_brief_archived_at.sql` | New: adds `archived_at` column |
| `db.js` | `upsertBrief` already handles arbitrary fields; no change needed |
| `index.html` | Add `archivedBriefs` global, `briefFilterActive` global, `shouldArchive()`, archival pass in `loadListArtists()`, glow dot in `renderList()`, filter toggle button + CSS, `renderBriefsTab()` archived section, `getFiltered()` brief filter condition |

## 7. Out of Scope

- Manual archive/un-archive controls
- Global "all archived briefs" view
- Push notifications when briefs are about to archive
