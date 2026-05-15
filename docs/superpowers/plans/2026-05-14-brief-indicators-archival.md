# Brief Indicators, Filter & Archival — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a glowing purple dot on artist avatars that have active briefs, add a "Briefs" filter toggle above the artist list, and automatically archive/expire old briefs with DB-backed timestamps.

**Architecture:** Computed archival thresholds run on each list load in `loadListArtists()`; newly-expired briefs get `archived_at` stamped via Supabase upsert; briefs past 2 months are deleted. Active briefs stay in `briefs[]`; archived-but-not-deleted live in `archivedBriefs[]`. The filter toggle is a sticky button above `#artist-cards`. The Briefs tab shows archived cards in a collapsible section below active ones.

**Tech Stack:** Vanilla JS in `index.html` (~4200 lines), Supabase (`briefs` table), one SQL migration.

**Spec:** `docs/superpowers/specs/2026-05-14-brief-indicators-archival-design.md`

---

## File Map

| File | What changes |
|---|---|
| `migration_v4_brief_archived_at.sql` | NEW: adds `archived_at` column |
| `index.html` | All JS + CSS + HTML changes (6 tasks below) |

`db.js` and `preload.js` require **no changes** — `upsertBrief` and `deleteBrief` already exist and handle arbitrary fields.

---

## Task 1: SQL Migration

**Files:**
- Create: `migration_v4_brief_archived_at.sql`
- Run in: Supabase SQL editor (Dashboard → SQL Editor → New query)

- [ ] **Step 1: Create the migration file**

```sql
-- migration_v4_brief_archived_at.sql
-- Adds archived_at to track when a brief was archived.
-- NULL = active. Set to a timestamp when archived. Briefs are deleted 2 months after this timestamp.
ALTER TABLE briefs ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;
```

- [ ] **Step 2: Run it in Supabase**

Paste the SQL above into the Supabase SQL editor and click Run. Expected result: "Success. No rows returned."

- [ ] **Step 3: Commit**

```bash
git add migration_v4_brief_archived_at.sql
git commit -m "migration: add archived_at to briefs"
```

---

## Task 2: State Globals + `shouldArchive()` Helper

**Files:**
- Modify: `index.html` — two locations

This task adds the three new global variables and the `shouldArchive()` function before any logic that depends on them.

- [ ] **Step 1: Add three globals in `index.html`**

Find this block (around line 2172):
```js
let briefs = [];          // all briefs for current list
let wsTab = 'contacts';   // 'contacts' | 'briefs'
```

Replace it with:
```js
let briefs = [];             // active (non-archived) briefs for current list
let archivedBriefs = [];     // archived-but-not-yet-deleted briefs
let wsTab = 'contacts';      // 'contacts' | 'briefs'
let briefFilterActive = false; // filter artist list to artists with active briefs
let archivedExpanded = false;  // archived section expanded in briefs tab
```

- [ ] **Step 2: Add `shouldArchive()` after `deadlineBadgeClass()`**

Find this block (around line 2648):
```js
  return 'asap';
}

function renderBriefsTab(artist) {
```

Insert the new function between them:
```js
  return 'asap';
}

function shouldArchive(brief) {
  const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  if (!brief.deadline) return new Date(brief.created_at) < oneMonthAgo;
  const d = brief.deadline.toUpperCase();
  if (d.includes('ASAP')) return new Date(brief.created_at) < oneMonthAgo;
  const parsed = new Date(brief.deadline.replace(/By\s*/i, '').trim());
  if (!isNaN(parsed)) return parsed < new Date();
  // Unparseable deadline string — treat like ASAP
  return new Date(brief.created_at) < oneMonthAgo;
}

function renderBriefsTab(artist) {
```

- [ ] **Step 3: Verify app still starts**

```bash
npm start
```

Expected: app opens, no console errors. No visible change yet.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add archivedBriefs state + shouldArchive() helper"
```

---

## Task 3: Archival Pass in `loadListArtists()`

**Files:**
- Modify: `index.html` — `loadListArtists()` function (around line 2197)

This replaces the simple `briefs = loadedBriefs` assignment with the full archival logic.

- [ ] **Step 1: Replace the briefs assignment in `loadListArtists()`**

Find this block (around line 2197):
```js
    artists = loadedArtists;
    briefs = loadedBriefs;
    contacts = loadedContacts.map(c => ({
```

Replace it with:
```js
    artists = loadedArtists;

    // Archival pass: stamp newly-expired briefs, delete very old ones
    const twoMonthsAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const nowIso = new Date().toISOString();
    const survivingBriefs = [];
    for (const brief of loadedBriefs) {
      if (brief.archived_at && new Date(brief.archived_at) < twoMonthsAgo) {
        window.kc.deleteBrief(brief.id); // fire and forget
        continue;
      }
      if (!brief.archived_at && shouldArchive(brief)) {
        brief.archived_at = nowIso;
        window.kc.upsertBrief(listId, brief); // fire and forget
      }
      survivingBriefs.push(brief);
    }
    briefs = survivingBriefs.filter(b => !b.archived_at);
    archivedBriefs = survivingBriefs.filter(b => !!b.archived_at);
    briefFilterActive = false;
    archivedExpanded = false;

    contacts = loadedContacts.map(c => ({
```

- [ ] **Step 2: Verify archival runs without errors**

```bash
npm start
```

Open DevTools (View → Toggle Developer Tools), open a list. Expected: no console errors. If you have a brief with a past deadline, it should get `archived_at` stamped (check Network tab or Supabase table).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: archival pass in loadListArtists — stamp and expire old briefs"
```

---

## Task 4: Glow Dot on Artist Avatar

**Files:**
- Modify: `index.html` — CSS section (two additions) + `renderList()` function

- [ ] **Step 1: Add `position: relative` to `.artist-row-avatar` CSS**

Find (around line 257):
```css
  .artist-row-avatar {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 8px;
    font-weight: 700;
    color: white;
  }
```

Replace with:
```css
  .artist-row-avatar {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 8px;
    font-weight: 700;
    color: white;
    position: relative;
  }
```

- [ ] **Step 2: Add `.artist-brief-dot` CSS after `.artist-row-dot` block**

Find (around line 288):
```css
  .artist-row-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
```

Replace with:
```css
  .artist-row-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .artist-brief-dot {
    position: absolute;
    top: -1px;
    right: -1px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #a855f7;
    border: 1.5px solid var(--bg);
    box-shadow: 0 0 5px rgba(168, 85, 247, 0.7);
    pointer-events: none;
  }
```

- [ ] **Step 3: Update `renderList()` to render the glow dot**

Find the artist row template inside `renderList()` (around line 2513):
```js
    return `
      <button class="artist-row ${selectedId === a.id ? 'active' : ''}" data-action="select" data-id="${h(a.id)}" ${dragAttrs}>
        <div class="artist-row-avatar" style="${avatarStyle}">${initials(a.label ? normalizeLabel(a.label) : a.name)}</div>
        <div class="artist-row-info">
          <div class="artist-row-name">${h(a.name)}</div>
        </div>
        <div class="artist-row-dot" style="background:${statusDot}"></div>
      </button>`;
```

Replace with:
```js
    const hasActiveBrief = briefs.some(b => b.artist_id === a.id);
    return `
      <button class="artist-row ${selectedId === a.id ? 'active' : ''}" data-action="select" data-id="${h(a.id)}" ${dragAttrs}>
        <div class="artist-row-avatar" style="${avatarStyle}">
          ${initials(a.label ? normalizeLabel(a.label) : a.name)}
          ${hasActiveBrief ? '<div class="artist-brief-dot"></div>' : ''}
        </div>
        <div class="artist-row-info">
          <div class="artist-row-name">${h(a.name)}</div>
        </div>
        <div class="artist-row-dot" style="background:${statusDot}"></div>
      </button>`;
```

- [ ] **Step 4: Verify the glow dot appears**

```bash
npm start
```

Open a list that has artists with active briefs. Expected: a small purple glowing dot visible on the top-right corner of the avatar for artists with briefs. Artists without briefs have no dot.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: purple glow dot on avatar for artists with active briefs"
```

---

## Task 5: Filter Toggle Button

**Files:**
- Modify: `index.html` — HTML structure, CSS, `renderList()`, `getFiltered()`, click event handler

- [ ] **Step 1: Add `#list-filter-bar` to the HTML**

Find (around line 1685):
```html
  <!-- ARTIST LIST -->
  <main class="artist-list">
    <div id="artist-cards"></div>
  </main>
```

Replace with:
```html
  <!-- ARTIST LIST -->
  <main class="artist-list">
    <div id="list-filter-bar"></div>
    <div id="artist-cards"></div>
  </main>
```

- [ ] **Step 2: Add CSS for the filter bar and toggle button**

Find the `/* ── ARTIST LIST ── */` section (around line 224) and add after the `.artist-row-dot`/`.artist-brief-dot` block (after line 294):

```css
  #list-filter-bar {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--bg);
    padding: 4px 2px 2px;
  }
  .brief-filter-toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 9px;
    font-weight: 700;
    font-family: var(--font-mono);
    padding: 3px 8px;
    border-radius: var(--r-sm);
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
    transition: color 0.1s, border-color 0.1s, background 0.1s;
    -webkit-appearance: none;
    appearance: none;
  }
  .brief-filter-toggle.on {
    background: rgba(168, 85, 247, 0.15);
    border-color: rgba(168, 85, 247, 0.5);
    color: #c084fc;
  }
```

- [ ] **Step 3: Populate the filter bar in `renderList()`**

Find the start of `renderList()` (around line 2479):
```js
function renderList() {
  const list = getFiltered();

  const cardsEl = document.getElementById('artist-cards');
```

Replace with:
```js
function renderList() {
  // Render filter bar
  const filterBar = document.getElementById('list-filter-bar');
  if (filterBar) {
    filterBar.innerHTML = briefs.length > 0
      ? `<button class="brief-filter-toggle ${briefFilterActive ? 'on' : ''}" data-action="toggle-brief-filter">◈ Briefs</button>`
      : '';
  }

  const list = getFiltered();

  const cardsEl = document.getElementById('artist-cards');
```

- [ ] **Step 4: Add the brief filter condition to `getFiltered()`**

Find `getFiltered()` (around line 2410):
```js
function getFiltered() {
  const filtered = artists.filter(a => {
    if (a._scanning) return true;
    if (activeLabel !== 'all' && normalizeLabel(a.label) !== activeLabel) return false;
    if (!searchQuery) return true;
```

Replace with:
```js
function getFiltered() {
  const filtered = artists.filter(a => {
    if (a._scanning) return true;
    if (activeLabel !== 'all' && normalizeLabel(a.label) !== activeLabel) return false;
    if (briefFilterActive && !briefs.some(b => b.artist_id === a.id)) return false;
    if (!searchQuery) return true;
```

- [ ] **Step 5: Add `toggle-brief-filter` to the click event handler**

Find the click handler (around line 3443):
```js
  if (action === 'select')              selectArtist(el.dataset.id);
  else if (action === 'filter')         setLabel(el.dataset.label);
```

Add after `else if (action === 'filter') setLabel(el.dataset.label);`:
```js
  else if (action === 'toggle-brief-filter') { briefFilterActive = !briefFilterActive; render(); }
```

- [ ] **Step 6: Verify the filter toggle works**

```bash
npm start
```

Expected:
- If there are active briefs: a small "◈ Briefs" button appears above the artist list
- Clicking it highlights the button purple and filters the list to only artists with active briefs
- Clicking again restores all artists
- Changing the label filter while "Briefs" is active shows only artists in that label with active briefs
- Switching lists resets the filter (button disappears / resets)

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: briefs filter toggle above artist list"
```

---

## Task 6: Archived Briefs Section in Briefs Tab

**Files:**
- Modify: `index.html` — CSS, `renderBriefsTab()`, click handler, `selectArtist()`

- [ ] **Step 1: Add archived section CSS**

After the `.brief-matched-contacts` CSS block, add:

```css
  .brief-archived-section {
    margin-top: 12px;
    border-top: 1px solid var(--border);
    padding-top: 8px;
  }
  .brief-archived-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 9px;
    font-weight: 700;
    font-family: var(--font-mono);
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    cursor: pointer;
    padding: 2px 0 6px;
    background: none;
    border: none;
    -webkit-appearance: none;
    appearance: none;
  }
  .brief-archived-header:hover { color: var(--text-muted); }
  .brief-card.archived {
    opacity: 0.5;
  }
  .archived-stamp {
    font-size: 9px;
    font-family: var(--font-mono);
    color: var(--text-dim);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 100px;
    padding: 2px 7px;
  }
```

- [ ] **Step 2: Replace the full `renderBriefsTab()` function**

Find the entire `renderBriefsTab()` function (starts around line 2651, ends around line 2724). Replace the whole function with the version below. The key change is that the early return when `artistBriefs.length === 0` now checks for archived briefs too — an artist with only archived briefs should still show the archived section.

Replace from `function renderBriefsTab(artist) {` through its closing `}` with the full new function below. Key differences from current code: (1) `artistArchived` is computed up front so the early-return check can see it; (2) the early return now requires **both** active AND archived to be empty; (3) archived section is appended after active briefs.

```js
function renderBriefsTab(artist) {
  const pane = document.getElementById('briefs-pane');
  if (!pane) return;
  pane.className = 'workspace-table-area briefs-pane';

  const artistBriefs = briefs.filter(b => b.artist_id === artist.id);
  const artistArchived = archivedBriefs.filter(b => b.artist_id === artist.id);

  if (artistBriefs.length === 0 && artistArchived.length === 0) {
    pane.innerHTML = `<div class="brief-empty">No briefs yet.<br>Click "+ Import Brief PDF" to add one.</div>`;
    return;
  }

  pane.innerHTML = artistBriefs.map(brief => {
    const badgeClass = deadlineBadgeClass(brief.deadline);
    const deadlineBadge = badgeClass && brief.deadline
      ? `<span class="deadline-badge ${badgeClass}">${h(brief.deadline)}</span>`
      : '';
    const emailPreview = (brief.submission_emails || []).slice(0, 3)
      .map(e => e.split('@')[0]).join(' · ');
    const emailsHTML = emailPreview ? `<span class="brief-emails">${h(emailPreview)}</span>` : '';
    const directionHTML = brief.general_direction
      ? `<div class="brief-section"><div class="brief-section-label">General Direction</div><div class="brief-direction-text">${h(brief.general_direction)}</div></div>`
      : '';
    const trackTypes = Array.isArray(brief.track_types) ? brief.track_types : [];
    const trackTypesHTML = trackTypes.length === 0 ? '' : `
      <div class="brief-section">
        <div class="brief-section-label">Track Types</div>
        ${trackTypes.map(tt => {
          const wants = (tt.wants || []).map(w => `· ${h(w)}`).join('<br>');
          const avoids = (tt.avoids || []).map(av => `✕ ${h(av)}`).join('<br>');
          const refs = (tt.references || [])
            .filter(r => r.url && (r.url.startsWith('https://') || r.url.startsWith('http://')))
            .map(r => `<a class="ref-pill" href="#" onclick="event.preventDefault();window.open('${h(r.url)}')">▶ ${h(r.title || r.url)}</a>`)
            .join('');
          const tagsLine = (tt.tags || []).length > 0
            ? `<div style="font-size:9px;color:var(--text-dim);font-family:var(--font-mono);margin-bottom:4px">${tt.tags.map(t => h(t)).join(' ')}</div>`
            : '';
          return `<div class="track-type-card"><div class="track-type-name">${h(tt.name || 'Track Type')}</div>${tagsLine}${wants ? `<div class="track-type-wants">${wants}</div>` : ''}${avoids ? `<div class="track-type-avoids">${avoids}</div>` : ''}${refs ? `<div class="track-type-refs">${refs}</div>` : ''}</div>`;
        }).join('')}
      </div>`;
    const matchedIds = brief.matched_contact_ids || [];
    const matchedBanner = matchedIds.length > 0
      ? `<div class="brief-matched-contacts">✓ ${matchedIds.length} contact${matchedIds.length !== 1 ? 's' : ''} matched from brief emails</div>`
      : '';
    return `
      <div class="brief-card">
        <div class="brief-card-header">
          <span class="brief-source">${h(brief.source_pdf || brief.label || 'Brief')}</span>
          ${deadlineBadge}${emailsHTML}
        </div>
        ${directionHTML}${trackTypesHTML}${matchedBanner}
      </div>`;
  }).join('');

  if (artistArchived.length > 0) {
    const chevron = archivedExpanded ? '▾' : '▸';
    const archivedCards = archivedExpanded
      ? artistArchived.map(brief => {
          const archivedDate = brief.archived_at
            ? new Date(brief.archived_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : '';
          const emailPreview = (brief.submission_emails || []).slice(0, 3)
            .map(e => e.split('@')[0]).join(' · ');
          const emailsHTML = emailPreview ? `<span class="brief-emails">${h(emailPreview)}</span>` : '';
          const directionHTML = brief.general_direction
            ? `<div class="brief-section"><div class="brief-section-label">General Direction</div><div class="brief-direction-text">${h(brief.general_direction)}</div></div>`
            : '';
          const trackTypes = Array.isArray(brief.track_types) ? brief.track_types : [];
          const trackTypesHTML = trackTypes.length === 0 ? '' : `
            <div class="brief-section">
              <div class="brief-section-label">Track Types</div>
              ${trackTypes.map(tt => {
                const wants = (tt.wants || []).map(w => `· ${h(w)}`).join('<br>');
                const avoids = (tt.avoids || []).map(av => `✕ ${h(av)}`).join('<br>');
                const refs = (tt.references || [])
                  .filter(r => r.url && (r.url.startsWith('https://') || r.url.startsWith('http://')))
                  .map(r => `<a class="ref-pill" href="#" onclick="event.preventDefault();window.open('${h(r.url)}')">▶ ${h(r.title || r.url)}</a>`)
                  .join('');
                const tagsLine = (tt.tags || []).length > 0
                  ? `<div style="font-size:9px;color:var(--text-dim);font-family:var(--font-mono);margin-bottom:4px">${tt.tags.map(t => h(t)).join(' ')}</div>`
                  : '';
                return `<div class="track-type-card"><div class="track-type-name">${h(tt.name || 'Track Type')}</div>${tagsLine}${wants ? `<div class="track-type-wants">${wants}</div>` : ''}${avoids ? `<div class="track-type-avoids">${avoids}</div>` : ''}${refs ? `<div class="track-type-refs">${refs}</div>` : ''}</div>`;
              }).join('')}
            </div>`;
          return `
            <div class="brief-card archived" style="margin-bottom:8px">
              <div class="brief-card-header">
                <span class="brief-source">${h(brief.source_pdf || brief.label || 'Brief')}</span>
                ${archivedDate ? `<span class="archived-stamp">Archived ${archivedDate}</span>` : ''}
                ${emailsHTML}
              </div>
              ${directionHTML}${trackTypesHTML}
            </div>`;
        }).join('')
      : '';
    pane.innerHTML += `
      <div class="brief-archived-section">
        <button class="brief-archived-header" data-action="toggle-archived-expanded">
          ${chevron} Archived (${artistArchived.length})
        </button>
        ${archivedCards}
      </div>`;
  }
}
```

- [ ] **Step 3: Add `toggle-archived-expanded` to the click handler**

In the same `document.addEventListener('click', ...)` block where you added `toggle-brief-filter`, add:
```js
  else if (action === 'toggle-archived-expanded') { archivedExpanded = !archivedExpanded; renderDetail(); }
```

- [ ] **Step 4: Reset `archivedExpanded` in `selectArtist()`**

Find `selectArtist()` (around line 2862):
```js
function selectArtist(id) {
  selectedId = id;
  selectedContactId = null;
  wsStatusFilter = 'all';
  wsTab = 'contacts';
  render();
```

Replace with:
```js
function selectArtist(id) {
  selectedId = id;
  selectedContactId = null;
  wsStatusFilter = 'all';
  wsTab = 'contacts';
  archivedExpanded = false;
  render();
```

- [ ] **Step 5: Verify archived section appears correctly**

```bash
npm start
```

To test archival UI without waiting for real briefs to expire, temporarily set a brief's `archived_at` directly in Supabase SQL editor:
```sql
UPDATE briefs SET archived_at = NOW() WHERE id = '<a brief id>';
```

Then reload the app. Expected:
- The brief no longer shows in the active briefs section
- The artist's Briefs tab shows "▸ Archived (1)" at the bottom
- Clicking it expands and shows the brief card at 50% opacity with "Archived [date]" tag instead of deadline badge
- Switching to a different artist collapses the section

Restore after testing:
```sql
UPDATE briefs SET archived_at = NULL WHERE id = '<a brief id>';
```

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: archived briefs collapsible section in briefs tab"
```

---

## Final Verification

- [ ] **Full flow test**

```bash
npm start
```

Checklist:
- [ ] Artists with active briefs show a small purple glowing dot on their avatar
- [ ] Artists without briefs show no dot
- [ ] If there are active briefs, "◈ Briefs" toggle button appears above the artist list
- [ ] Clicking toggle filters list to artists with active briefs only (button turns purple)
- [ ] Label filter + briefs filter work together correctly
- [ ] Switching lists resets brief filter and archived expanded state
- [ ] Archived briefs (set via Supabase) do not show in active briefs
- [ ] Archived section appears in Briefs tab with correct count and expand/collapse
- [ ] Archived card shows dimmed with "Archived [date]" tag, no deadline badge
- [ ] Briefs with deadlines >2 months in the past are deleted on load

- [ ] **Update HANDOFF.md** to reflect the new state

Update `HANDOFF.md` — Current State section to say briefs indicators + archival are complete. Add the new globals (`archivedBriefs`, `briefFilterActive`, `archivedExpanded`) to the JS State Globals section. Add `shouldArchive()` to the Key files and functions section.

```bash
git add HANDOFF.md
git commit -m "docs: update HANDOFF with brief indicators + archival"
```
