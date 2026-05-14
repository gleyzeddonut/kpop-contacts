# K:CONTACTS Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the K:CONTACTS UI around an artist-first workflow — compact artist rows, contact table with status badges, a double-click notes panel with inline editing, and removal of the Labels view.

**Architecture:** All UI lives in `index.html` (CSS + HTML + JS, ~3700 lines). The DB migration adds two columns to Supabase `contacts`. No changes to `db.js`, `main.js`, or `preload.js` — `upsertContact` already passes all fields through. Each task produces a working app state before moving on.

**Tech Stack:** Electron 35, vanilla JS, CSS grid, Supabase (postgres + realtime), Anthropic API

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `migration_v2_status_notes.sql` | Create | Adds `status` + `notes_log` columns, migrates existing `notes` data |
| `index.html` | Modify | CSS layout, artist row rendering, workspace/contact table, notes panel, contact CRUD |
| `db.js` | No change | `upsertContact` already passes all fields through |
| `main.js` | No change | IPC unchanged |
| `preload.js` | No change | Bridge unchanged |

---

## Task 1: DB Migration — Add `status` and `notes_log` columns

**Files:**
- Create: `migration_v2_status_notes.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- migration_v2_status_notes.sql
-- Run in Supabase SQL Editor

-- 1. Add status column
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'cold'
  CHECK (status IN ('cold', 'reached_out', 'in_convo', 'placed'));

-- 2. Add notes_log column (replaces freeform notes string)
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS notes_log jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 3. Migrate existing notes text → first notes_log entry (skip if already blank)
UPDATE contacts
SET notes_log = jsonb_build_array(
  jsonb_build_object(
    'date', to_char(NOW(), 'YYYY-MM-DD'),
    'text', notes
  )
)
WHERE notes IS NOT NULL AND notes <> '' AND notes_log = '[]'::jsonb;
```

- [ ] **Step 2: Run it in Supabase**

Open Supabase → SQL Editor → paste the file contents → Run.
Expected: "Success. No rows returned." (or similar, no error)

- [ ] **Step 3: Verify in Supabase Table Editor**

Open Table Editor → `contacts` table. Confirm two new columns: `status` (default `cold`) and `notes_log` (default `[]`).

- [ ] **Step 4: Commit**

```bash
git add migration_v2_status_notes.sql
git commit -m "db: add status and notes_log columns to contacts"
```

---

## Task 2: Remove the Labels/Contacts View

The app currently has a `listView` toggle (`'artists'` | `'contacts'`) that swaps the main area between an artist list and a full contacts directory. We're dropping the contacts view entirely.

**Files:**
- Modify: `index.html`

**What to remove:**
- JS state: `let listView`, `let contactsSearchQuery`, `let contactsSortMode`, `let contactsActiveLabel` (lines ~2184–2190)
- JS functions: `renderContactsView()` (~line 2435–2537), `setListView()` (~line 2566–2575), `updateContactArtistSection()` (~line 2539–2555)
- `render()` no longer needs the `if (listView === 'contacts')` branch (~line 2559–2563)
- HTML: view toggle buttons (`view-btn-artists`, `view-btn-contacts`) in the header
- HTML: `<div id="contacts-view">` and `<div id="contacts-label-nav">` elements
- CSS: all `.view-contacts` rules (~line 251–263), `#contacts-view` styles (~line 266+), `.cb-*` styles (contacts-browser cards)

- [ ] **Step 1: Remove the four state variables**

Find and delete these four lines (around line 2184–2190):
```js
// DELETE these lines:
let contactsSearchQuery = '';
let contactsSortMode = 'name';
let contactsActiveLabel = 'all';
// ALSO DELETE:
let listView = 'artists';
```

- [ ] **Step 2: Simplify `render()`**

Find `render()` (~line 2559) and replace with:
```js
function render() {
  renderSidebar();
  renderList();
  renderDetail();
  updateDatalist();
}
```

- [ ] **Step 3: Delete `setListView()`, `renderContactsView()`, `updateContactArtistSection()`**

Delete the three functions entirely:
- `setListView()` (~line 2566–2575)
- `renderContactsView()` (~line 2435–2537)
- `updateContactArtistSection()` (~line 2539–2555)

- [ ] **Step 4: Remove view toggle buttons from HTML header**

Find the two view toggle buttons in the `<header>` HTML — they have ids `view-btn-artists` and `view-btn-contacts`. Delete both `<button>` elements.

- [ ] **Step 5: Remove contacts-view HTML**

Find and delete the `<div id="contacts-view">` element and `<div id="contacts-label-nav">` element from the `<main>` area.

- [ ] **Step 6: Remove contacts-view CSS**

Delete the following CSS blocks:
- `.app.view-contacts { ... }` and all `.app.view-contacts .xyz { ... }` rules (~lines 251–263)
- `#contacts-view { ... }` rule (~line 266+)
- All `.cb-*` rules (contacts browser card styles)

- [ ] **Step 7: Start the app and verify no console errors**

```bash
npm start
```
Expected: app loads, no JS errors, artist list and detail panel still show. The view toggle buttons are gone from the header.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "remove labels/contacts view and toggle"
```

---

## Task 3: Redesign CSS Layout

Change the 3-column grid from `210px | 1fr | 380px` (sidebar | list | detail) to `148px | 185px | 1fr` (sidebar | artist-list | workspace). The "detail panel" becomes the "workspace" and takes the remaining space.

**Files:**
- Modify: `index.html` (CSS section only)

- [ ] **Step 1: Update the root grid**

Find the `.app` CSS rule (~line 43) and update column widths:
```css
.app {
  display: grid;
  grid-template-rows: 54px 1fr;
  grid-template-columns: 148px 185px 1fr;
  height: 100vh;
  overflow: hidden;
  grid-template-areas:
    "header header header"
    "sidebar list detail";
}
```

- [ ] **Step 2: Update the artist list column styles**

Find `.artist-list` (~line 214) and update:
```css
.artist-list {
  grid-area: list;
  overflow-y: auto;
  overflow-x: hidden;
  border-right: 1px solid var(--border);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
```

- [ ] **Step 3: Update the detail panel to become the workspace**

Find `.detail-panel` (~line 509) and replace its width/min-width rules so it just fills grid-area `detail`:
```css
.detail-panel {
  grid-area: detail;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  min-width: 0;
}
```

Remove any hardcoded `width: 380px` or `min-width` on `.detail-panel`.

- [ ] **Step 4: Add artist row styles**

Add these new CSS rules for the compact artist rows (replacing the `.artist-card` card styles):
```css
.artist-row {
  height: 34px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.1s;
  flex-shrink: 0;
}
.artist-row:hover { background: var(--card); }
.artist-row.active { background: var(--card); border-color: var(--border); }

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
.artist-row-info {
  flex: 1;
  min-width: 0;
}
.artist-row-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.artist-row-label {
  font-size: 8px;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.artist-row-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
```

- [ ] **Step 5: Add workspace inner layout styles**

The detail panel (workspace) needs an inner flex layout for the contact table + optional notes panel:
```css
.workspace-body {
  display: flex;
  flex: 1;
  overflow: hidden;
  min-width: 0;
}
.workspace-table-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}
.workspace-notes-panel {
  width: 240px;
  border-left: 1px solid var(--border);
  background: #0f0f15;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow: hidden;
  /* hidden by default, shown when a contact is selected */
  display: none;
}
.workspace-notes-panel.open {
  display: flex;
}
```

- [ ] **Step 6: Start the app and verify layout**

```bash
npm start
```
Expected: sidebar is ~148px, artist list column is ~185px, workspace takes the rest. May look rough — rendering functions haven't been updated yet.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "redesign css layout: 3-col grid, artist rows, workspace"
```

---

## Task 4: Redesign Artist List Rendering

Replace the current `renderList()` card-based output with compact rows that show: avatar initial, artist name, label, and a status dot derived from the artist's contacts.

**Files:**
- Modify: `index.html` (JS section, `renderList()` function)

- [ ] **Step 1: Add a helper to compute an artist's status dot color**

Add this function just before `renderList()`:
```js
function artistStatusDot(artistId) {
  const artistContacts = contacts.filter(c =>
    Array.isArray(c.artist_ids) && c.artist_ids.includes(artistId)
  );
  if (artistContacts.some(c => c.status === 'in_convo'))  return '#FF9500';
  if (artistContacts.some(c => c.status === 'placed'))    return '#BF5AF2';
  if (artistContacts.some(c => c.status === 'reached_out')) return '#30D158';
  if (artistContacts.some(c => c.status === 'cold'))      return '#6a8aff';
  return '#3a3a48'; // no contacts
}
```

- [ ] **Step 2: Replace `renderList()` body**

Find `renderList()` (~line 2597) and replace the entire function body:
```js
function renderList() {
  const list = getFiltered();
  document.getElementById('artist-count').textContent =
    `${list.length} artist${list.length !== 1 ? 's' : ''}`;

  const cardsEl = document.getElementById('artist-cards');
  cardsEl.className = '';

  if (!list.length) {
    cardsEl.innerHTML = `
      <div class="empty-list">
        <div class="ei">◈</div>
        <p>${searchQuery ? 'no results found' : 'no artists yet'}</p>
      </div>`;
    return;
  }

  cardsEl.innerHTML = list.map(a => {
    if (a._scanning) return `
      <div class="artist-row">
        <div class="artist-row-avatar" style="background:#2a2a32;color:#555">…</div>
        <div class="artist-row-info">
          <div class="artist-row-name" style="opacity:0.5">${h(a.name)}</div>
          <div class="artist-row-label">
            <span class="scan-spinner" style="width:8px;height:8px;border-width:1.5px;display:inline-block;vertical-align:middle;margin-right:4px"></span>scanning
          </div>
        </div>
      </div>`;

    const st = getLabelStyle(a.label);
    const dot = a.label ? st.dot : '#4A4A54';
    const r = parseInt(dot.slice(1,3),16), g = parseInt(dot.slice(3,5),16), b = parseInt(dot.slice(5,7),16);
    const avatarStyle = `background:rgba(${r},${g},${b},0.2);color:${dot}`;
    const statusDot = artistStatusDot(a.id);
    return `
      <button class="artist-row ${selectedId === a.id ? 'active' : ''}" data-action="select" data-id="${h(a.id)}">
        <div class="artist-row-avatar" style="${avatarStyle}">${initials(a.name)}</div>
        <div class="artist-row-info">
          <div class="artist-row-name">${h(a.name)}</div>
          <div class="artist-row-label">${h(a.label || '—')}</div>
        </div>
        <div class="artist-row-dot" style="background:${statusDot}"></div>
      </button>`;
  }).join('');
}
```

- [ ] **Step 3: Start the app and verify**

```bash
npm start
```
Expected: artist list shows compact rows with avatar initial, name, label, and a small dot on the right. No cards/borders like before. Status dots show dim (#3a3a48) if no contacts exist.

- [ ] **Step 4: Remove old `.artist-card` CSS**

Delete or comment out the `.artist-card` CSS rules (styles for the old card layout). Search for `.artist-card` in the CSS section and remove those blocks.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "redesign artist list: compact rows with status dot"
```

---

## Task 5: Redesign the Workspace (Artist Header + Contact Table)

Replace `renderDetail()` with a new workspace layout: artist name header with status filter pills, then a compact contact table with rows showing #, name, role, email, status badge, and hover action buttons.

**Files:**
- Modify: `index.html` (CSS + JS)

- [ ] **Step 1: Add CSS for workspace header and contact table**

Add these CSS rules:
```css
/* Workspace header */
.ws-header {
  padding: 13px 16px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.ws-title-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 8px;
}
.ws-artist-name {
  font-size: 18px;
  font-weight: 800;
  color: var(--text);
}
.ws-artist-label {
  font-size: 11px;
  color: var(--accent);
  font-weight: 500;
}
.ws-contact-count {
  font-size: 9px;
  color: var(--text-dim);
  margin-left: auto;
}
.ws-status-pills {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.ws-pill {
  padding: 3px 10px;
  border-radius: 100px;
  font-size: 9px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: opacity 0.1s;
}
.ws-pill.all { background: var(--card); color: var(--text-muted); border-color: var(--border); }
.ws-pill.all.active { background: var(--card-hover); color: var(--text); }
.ws-pill.cold { background: #0d1230; color: #6a8aff; border-color: #1a2060; }
.ws-pill.reached_out { background: #0d2018; color: #30D158; border-color: #1a4030; }
.ws-pill.in_convo { background: #2a1a0a; color: #FF9500; border-color: #4a3010; }
.ws-pill.placed { background: #1a0d20; color: #BF5AF2; border-color: #3a1a50; }

/* Contact table */
.contact-table {
  flex: 1;
  overflow-y: auto;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.contact-col-heads {
  display: grid;
  grid-template-columns: 22px 1.5fr 1fr 1.4fr 0.8fr 52px;
  padding: 4px 8px;
  gap: 6px;
  font-size: 8px;
  font-weight: 600;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
  margin-bottom: 2px;
}
.contact-table-row {
  display: grid;
  grid-template-columns: 22px 1.5fr 1fr 1.4fr 0.8fr 52px;
  padding: 7px 8px;
  gap: 6px;
  border-radius: 7px;
  align-items: center;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.1s;
}
.contact-table-row:hover { background: var(--card); }
.contact-table-row.selected { background: var(--card); border-color: var(--border); }
.ctr-num { font-size: 9px; color: var(--text-dim); font-family: var(--font-mono); text-align: right; }
.ctr-name { font-size: 11px; font-weight: 600; color: var(--text); }
.ctr-role { font-size: 10px; color: var(--text-muted); }
.ctr-email { font-size: 10px; color: var(--accent); cursor: pointer; }
.ctr-email:hover { text-decoration: underline; }
.status-badge {
  display: inline-block;
  padding: 2px 7px;
  border-radius: 100px;
  font-size: 8px;
  font-weight: 700;
}
.status-badge.cold { background: #0d1230; color: #6a8aff; border: 1px solid #1a2060; }
.status-badge.reached_out { background: #0d2018; color: #30D158; border: 1px solid #1a4030; }
.status-badge.in_convo { background: #2a1a0a; color: #FF9500; border: 1px solid #4a3010; }
.status-badge.placed { background: #1a0d20; color: #BF5AF2; border: 1px solid #3a1a50; }
.ctr-actions { display: flex; gap: 3px; opacity: 0; transition: opacity 0.1s; }
.contact-table-row:hover .ctr-actions { opacity: 1; }
.ctr-btn {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  background: var(--card-hover);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  cursor: pointer;
  color: var(--text-muted);
}
.ctr-btn:hover { background: var(--accent); color: white; border-color: var(--accent); }
.add-contact-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  font-size: 10px;
  color: var(--text-dim);
  cursor: pointer;
  border-radius: 7px;
  margin-top: 2px;
}
.add-contact-row:hover { background: var(--card); color: var(--text-muted); }
.add-contact-row-icon {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1px dashed var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}
```

- [ ] **Step 2: Add a module-level variable for the active status filter and selected contact**

Add these two state variables near the other globals (~line 2181):
```js
let wsStatusFilter = 'all'; // filter pill selection in workspace
let selectedContactId = null; // contact whose notes panel is open
```

- [ ] **Step 3: Replace `renderDetail()` with new workspace renderer**

Find `renderDetail()` (~line 2653) and replace the entire function:
```js
function renderDetail() {
  const empty = document.getElementById('detail-empty');
  const content = document.getElementById('detail-content');

  if (!selectedId) {
    empty.style.display = 'flex';
    content.style.display = 'none';
    return;
  }
  const a = artists.find(x => x.id === selectedId);
  if (!a) {
    empty.style.display = 'flex';
    content.style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  content.style.display = 'flex';
  content.style.flexDirection = 'column';
  content.style.height = '100%';

  const artistContacts = contacts.filter(c =>
    Array.isArray(c.artist_ids) && c.artist_ids.includes(a.id)
  );

  // Status filter counts
  const statusCounts = { cold: 0, reached_out: 0, in_convo: 0, placed: 0 };
  artistContacts.forEach(c => { if (statusCounts[c.status] !== undefined) statusCounts[c.status]++; });

  // Filtered contact list
  const filtered = wsStatusFilter === 'all'
    ? artistContacts
    : artistContacts.filter(c => c.status === wsStatusFilter);

  const pillsHTML = [
    `<button class="ws-pill all ${wsStatusFilter==='all'?'active':''}" onclick="wsStatusFilter='all';renderDetail()">All ${artistContacts.length}</button>`,
    ...Object.entries(statusCounts)
      .filter(([,n]) => n > 0)
      .map(([s,n]) => `<button class="ws-pill ${s} ${wsStatusFilter===s?'active':''}" onclick="wsStatusFilter='${s}';renderDetail()">${statusLabel(s)} ${n}</button>`)
  ].join('');

  const rowsHTML = filtered.length === 0
    ? `<div style="padding:20px 8px;font-size:11px;color:var(--text-dim);font-family:var(--font-mono)">No contacts${wsStatusFilter !== 'all' ? ' with this status' : ' yet'}.</div>`
    : filtered.map((c, i) => `
      <div class="contact-table-row ${selectedContactId===c.id?'selected':''}"
           data-action="select-contact" data-contact-id="${h(c.id)}"
           ondblclick="toggleNotesPanel('${h(c.id)}')">
        <div class="ctr-num">${i+1}</div>
        <div class="ctr-name">${h(c.name)}</div>
        <div class="ctr-role">${h(c.role||'—')}</div>
        <div class="ctr-email" data-action="copy" data-value="${h(c.email||'')}">${h(c.email||'—')}</div>
        <div><span class="status-badge ${c.status||'cold'}">${statusLabel(c.status||'cold')}</span></div>
        <div class="ctr-actions">
          ${c.email ? `<button class="ctr-btn" data-action="mailto" data-value="${h(c.email)}" title="Email">✉</button>` : ''}
          <button class="ctr-btn" data-action="open-notes" data-contact-id="${h(c.id)}" title="Notes">✎</button>
        </div>
      </div>`).join('');

  content.innerHTML = `
    <div class="ws-header">
      <div class="ws-title-row">
        <span class="ws-artist-name">${h(a.name)}</span>
        <span class="ws-artist-label">${h(a.label||'')}</span>
        <span class="ws-contact-count">${artistContacts.length} contact${artistContacts.length!==1?'s':''}</span>
      </div>
      <div class="ws-status-pills">${pillsHTML}</div>
    </div>
    <div class="workspace-body">
      <div class="workspace-table-area">
        <div class="contact-table">
          <div class="contact-col-heads">
            <div></div><div>Name</div><div>Role</div><div>Email</div><div>Status</div><div></div>
          </div>
          ${rowsHTML}
          <div class="add-contact-row" data-action="add-contact" data-id="${h(a.id)}" data-label="${h(a.label||'')}">
            <div class="add-contact-row-icon">+</div>
            Add contact
          </div>
        </div>
      </div>
      <div id="notes-panel" class="workspace-notes-panel ${selectedContactId ? 'open' : ''}">
        <!-- populated by renderNotesPanel() -->
      </div>
    </div>`;

  if (selectedContactId) {
    const sc = contacts.find(c => c.id === selectedContactId);
    if (sc && artistContacts.some(c => c.id === selectedContactId)) {
      renderNotesPanel(sc);
    } else {
      selectedContactId = null;
    }
  }
}
```

- [ ] **Step 4: Add `statusLabel()` helper**

Add this function near the other utils:
```js
function statusLabel(s) {
  return { cold: 'Cold', reached_out: 'Reached Out', in_convo: 'In Convo', placed: 'Placed' }[s] || s;
}
```

- [ ] **Step 5: Add stub for `renderNotesPanel()` and `toggleNotesPanel()`**

Add these stubs (they'll be fleshed out in Task 6):
```js
function toggleNotesPanel(contactId) {
  if (selectedContactId === contactId) {
    selectedContactId = null;
  } else {
    selectedContactId = contactId;
  }
  renderDetail();
}

function renderNotesPanel(contact) {
  const panel = document.getElementById('notes-panel');
  if (!panel) return;
  panel.innerHTML = `<div style="padding:16px;font-size:11px;color:var(--text-muted)">${h(contact.name)} — notes panel coming soon</div>`;
}
```

- [ ] **Step 6: Update `selectArtist()` to close the notes panel on artist switch**

Find `selectArtist()` (~line 2763) and update:
```js
function selectArtist(id) {
  selectedId = id;
  selectedContactId = null;
  wsStatusFilter = 'all';
  render();
}
```

- [ ] **Step 7: Update event handler for `open-notes` and `mailto` actions**

Find the main click-event handler (likely `document.addEventListener('click', ...)` or `handleAction()`). Add handling for the new `open-notes` and `mailto` actions:
```js
// In the click handler, add:
if (action === 'open-notes') {
  const contactId = e.target.closest('[data-action]').dataset.contactId;
  selectedContactId = selectedContactId === contactId ? null : contactId;
  renderDetail();
}
if (action === 'mailto') {
  const email = e.target.closest('[data-action]').dataset.value;
  if (email) window.open(`mailto:${email}`, '_blank');
}
```

- [ ] **Step 8: Start the app and verify**

```bash
npm start
```
Expected: clicking an artist shows workspace with their name + label as header, status filter pills (only for statuses with contacts), contact rows in the table. Double-clicking a row or clicking the ✎ button should show the stub notes panel on the right.

- [ ] **Step 9: Commit**

```bash
git add index.html
git commit -m "redesign workspace: artist header, contact table, status pills"
```

---

## Task 6: Build the Notes Panel

Replace the stub `renderNotesPanel()` with the full implementation: inline-editable fields, status dots, quick actions, and a timestamped notes log.

**Files:**
- Modify: `index.html` (CSS + JS)

- [ ] **Step 1: Add notes panel CSS**

Add these CSS rules:
```css
/* Notes panel */
.np-header {
  padding: 13px 14px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.np-close {
  float: right;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  background: var(--card);
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.np-close:hover { background: var(--card-hover); color: var(--text); }

.np-field {
  display: block;
  width: 100%;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--text);
  font-family: var(--font-display);
  outline: none;
  padding: 2px 4px;
  transition: border-color 0.1s;
}
.np-field:hover { border-color: var(--border); }
.np-field:focus { border-color: var(--border-light); background: var(--card); }
.np-field-name { font-size: 13px; font-weight: 700; margin-bottom: 2px; }
.np-field-sm { font-size: 10px; color: var(--text-muted); }
.np-field-sm::placeholder { color: var(--text-dim); }

.np-status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.np-status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  cursor: pointer;
  opacity: 0.3;
  transition: opacity 0.1s, transform 0.1s;
  flex-shrink: 0;
}
.np-status-dot:hover { opacity: 0.7; }
.np-status-dot.active { opacity: 1; transform: scale(1.2); }
.np-status-label-text { font-size: 9px; font-weight: 600; }

.np-actions {
  display: flex;
  gap: 6px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.np-action-btn {
  flex: 1;
  height: 26px;
  border-radius: 6px;
  background: var(--card);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 9px;
  font-family: var(--font-display);
  color: var(--text-muted);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.np-action-btn:hover { background: var(--card-hover); color: var(--text); }
.np-action-btn:disabled { opacity: 0.3; cursor: default; }

.np-notes-area {
  flex: 1;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
}
.np-notes-section-label {
  font-size: 8px;
  font-weight: 700;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  flex-shrink: 0;
}
.np-note-entry {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 8px 10px;
  flex-shrink: 0;
}
.np-note-date {
  font-size: 8px;
  color: var(--text-dim);
  font-family: var(--font-mono);
  margin-bottom: 4px;
}
.np-note-text {
  font-size: 10px;
  color: var(--text-muted);
  line-height: 1.5;
}
.np-add-note-btn {
  height: 32px;
  border-radius: 7px;
  border: 1px dashed var(--border);
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-family: var(--font-display);
  color: var(--text-dim);
  cursor: pointer;
  flex-shrink: 0;
  margin-top: auto;
  transition: border-color 0.1s, color 0.1s;
}
.np-add-note-btn:hover { border-color: var(--accent); color: var(--accent); }

.np-note-input {
  width: 100%;
  background: var(--card);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  color: var(--text);
  font-family: var(--font-display);
  font-size: 10px;
  padding: 8px 10px;
  outline: none;
  resize: none;
  line-height: 1.5;
  flex-shrink: 0;
}
.np-note-input:focus { border-color: var(--accent); }
```

- [ ] **Step 2: Replace `renderNotesPanel()` with the full implementation**

```js
function renderNotesPanel(contact) {
  const panel = document.getElementById('notes-panel');
  if (!panel) return;

  const statusColors = { cold: '#6a8aff', reached_out: '#30D158', in_convo: '#FF9500', placed: '#BF5AF2' };
  const currentStatus = contact.status || 'cold';
  const notesLog = Array.isArray(contact.notes_log) ? contact.notes_log : [];

  const statusDotsHTML = Object.entries(statusColors).map(([s, color]) => `
    <div class="np-status-dot ${currentStatus===s?'active':''}"
         style="background:${color}"
         title="${statusLabel(s)}"
         onclick="setContactStatus('${h(contact.id)}','${s}')"></div>
  `).join('');

  const logsHTML = notesLog.length === 0
    ? `<div style="font-size:10px;color:var(--text-dim)">No notes yet.</div>`
    : [...notesLog].reverse().map(entry => `
        <div class="np-note-entry">
          <div class="np-note-date">${h(entry.date)}</div>
          <div class="np-note-text">${h(entry.text)}</div>
        </div>`).join('');

  panel.innerHTML = `
    <div class="np-header">
      <button class="np-close" onclick="toggleNotesPanel('${h(contact.id)}')">✕</button>
      <input class="np-field np-field-name" value="${h(contact.name)}"
             placeholder="Name"
             onblur="saveContactField('${h(contact.id)}','name',this.value)">
      <input class="np-field np-field-sm" value="${h(contact.role||'')}"
             placeholder="Role"
             onblur="saveContactField('${h(contact.id)}','role',this.value)">
      <input class="np-field np-field-sm" value="${h(contact.email||'')}"
             placeholder="Email"
             onblur="saveContactField('${h(contact.id)}','email',this.value)">
      <input class="np-field np-field-sm" value="${h(contact.phone||'')}"
             placeholder="Phone"
             onblur="saveContactField('${h(contact.id)}','phone',this.value)">
      <input class="np-field np-field-sm" value="${h(contact.social||'')}"
             placeholder="Instagram / Twitter"
             onblur="saveContactField('${h(contact.id)}','social',this.value)">
      <div class="np-status-row">
        ${statusDotsHTML}
        <span class="np-status-label-text" style="color:${statusColors[currentStatus]}">${statusLabel(currentStatus)}</span>
      </div>
    </div>
    <div class="np-actions">
      <button class="np-action-btn" ${contact.email?'':`disabled`} onclick="window.open('mailto:${h(contact.email||'')}','_blank')">✉ Email</button>
      <button class="np-action-btn" ${contact.email?'':`disabled`} onclick="copyText('${h(contact.email||'')}')">⎘ Copy</button>
      <button class="np-action-btn" ${contact.social?'':`disabled`} onclick="window.open('https://instagram.com/${h(contact.social||'').replace(/^@/,'')}','_blank')">↗ DM</button>
    </div>
    <div class="np-notes-area">
      <div class="np-notes-section-label">Notes</div>
      ${logsHTML}
      <button class="np-add-note-btn" onclick="showAddNoteInput('${h(contact.id)}')">+ Add note</button>
    </div>`;
}
```

- [ ] **Step 3: Add `saveContactField()` for inline field editing**

```js
function saveContactField(contactId, field, value) {
  const idx = contacts.findIndex(c => c.id === contactId);
  if (idx < 0) return;
  if (contacts[idx][field] === value.trim()) return; // no change
  contacts[idx] = { ...contacts[idx], [field]: value.trim() };
  renderDetail();
  syncContact(contacts[idx]);
}
```

- [ ] **Step 4: Add `setContactStatus()` for status dot clicks**

```js
function setContactStatus(contactId, status) {
  const idx = contacts.findIndex(c => c.id === contactId);
  if (idx < 0) return;
  contacts[idx] = { ...contacts[idx], status };
  renderDetail();
  syncContact(contacts[idx]);
}
```

- [ ] **Step 5: Add `showAddNoteInput()` and `saveNote()`**

```js
function showAddNoteInput(contactId) {
  const panel = document.getElementById('notes-panel');
  if (!panel) return;
  const addBtn = panel.querySelector('.np-add-note-btn');
  if (!addBtn) return;

  const textarea = document.createElement('textarea');
  textarea.className = 'np-note-input';
  textarea.placeholder = 'Add a note…';
  textarea.rows = 3;
  addBtn.replaceWith(textarea);
  textarea.focus();

  function commit() {
    const text = textarea.value.trim();
    if (text) saveNote(contactId, text);
    else renderDetail(); // re-render to restore button
  }

  textarea.addEventListener('blur', commit);
  textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); textarea.blur(); }
    if (e.key === 'Escape') { textarea.removeEventListener('blur', commit); renderDetail(); }
  });
}

function saveNote(contactId, text) {
  const idx = contacts.findIndex(c => c.id === contactId);
  if (idx < 0) return;
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const entry = { date: today, text };
  const existing = Array.isArray(contacts[idx].notes_log) ? contacts[idx].notes_log : [];
  contacts[idx] = { ...contacts[idx], notes_log: [...existing, entry] };
  renderDetail();
  syncContact(contacts[idx]);
}
```

- [ ] **Step 6: Start the app and exercise the notes panel**

```bash
npm start
```
Manual verification:
1. Click an artist → see contact table
2. Double-click a contact row → notes panel slides open on right
3. Edit name/role/email fields → click away → verify changes persist (check Supabase or localStorage)
4. Click a status dot → badge in table updates, dot highlights
5. Click "+ Add note" → textarea appears → type a note → Enter → note appears with today's date
6. Double-click same row again → panel closes
7. Select different artist → panel closes

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "add notes panel: inline editing, status dots, timestamped notes log"
```

---

## Task 7: Replace Contact Modal with Notes Panel "Add Contact" Flow

The old "Add Contact" button opened `openContactModal()`. Now it should open a blank notes panel in create mode. We also need to wire up contact deletion from the panel, and update `syncContact()` to pass through `status` and `notes_log`.

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Update `syncContact()` to handle new fields**

Find `syncContact()` (~line 2235) and verify it passes all fields. It likely looks like:
```js
async function syncContact(contact) {
  if (!currentListId) return;
  try { await window.kc.upsertContact(currentListId, contact); }
  catch (err) { console.warn('syncContact failed', err); }
}
```
No change needed — `upsertContact` in `db.js` already spreads all fields through. But confirm `status` and `notes_log` are not stripped anywhere. The `upsertContact` in `db.js` does:
```js
const { list_id, created_at, ...rest } = contact
```
This keeps `status` and `notes_log` in `rest`. No change needed to `db.js`.

- [ ] **Step 2: Update the "add-contact" action handler**

Find where `data-action="add-contact"` is handled in the event listener. Replace the call to `openContactModal(...)` with:
```js
if (action === 'add-contact') {
  const artistId = el.dataset.id;
  const label = el.dataset.label || '';
  const a = artists.find(x => x.id === artistId);
  const newContact = {
    id: uid(),
    list_id: currentListId,
    label,
    artist_ids: artistId ? [artistId] : [],
    name: 'New Contact',
    role: '',
    email: '',
    phone: '',
    social: '',
    status: 'cold',
    notes_log: [],
  };
  contacts.push(newContact);
  selectedContactId = newContact.id;
  renderDetail();
  syncContact(newContact);
  // focus the name field in the panel
  setTimeout(() => {
    const nameField = document.querySelector('.np-field-name');
    if (nameField) { nameField.focus(); nameField.select(); }
  }, 50);
}
```

- [ ] **Step 3: Add delete contact from notes panel**

Add a delete button to the notes panel header (in `renderNotesPanel()`). Add this just before the close button line:
```js
// In renderNotesPanel(), add to panel innerHTML header:
// After the np-close button:
`<button class="np-close" style="margin-right:4px;color:#FF5555" 
   onclick="confirmDelete('contact','${h(contact.id)}')">🗑</button>`
```

So the header div starts with:
```html
<div class="np-header">
  <button class="np-close" style="margin-right:4px;color:var(--accent-dim)" 
          onclick="confirmDelete('contact','${h(contact.id)}')">
    ${iconTrash()}
  </button>
  <button class="np-close" onclick="toggleNotesPanel('${h(contact.id)}')">✕</button>
  ...
```

- [ ] **Step 4: Update `deleteContact()` to close the panel**

Find `deleteContact()` (~line 2939) and update:
```js
function deleteContact(contactId) {
  contacts = contacts.filter(c => c.id !== contactId);
  if (selectedContactId === contactId) selectedContactId = null;
  renderDetail();
  toast('Contact deleted');
  syncDeleteContact(contactId);
}
```

- [ ] **Step 5: Update `migrateEmbeddedContacts()` to add default fields**

Find `migrateEmbeddedContacts()` (~line 2247). In the part where it creates new contact objects from embedded data, add `status` and `notes_log`:
```js
// Find where new contacts are constructed inside migrateEmbeddedContacts
// and add these fields to the object:
status: 'cold',
notes_log: c.notes ? [{ date: new Date().toISOString().slice(0,10), text: c.notes }] : [],
```

- [ ] **Step 6: Update `processScanQueue()` to set default fields on scanned contacts**

Find `processScanQueue()` (~line 3062), the part that constructs `scannedContacts`. Add `status` and `notes_log`:
```js
const scannedContacts = (artist.contacts || []).map(c => ({
  id: uid(),
  label: newArtist.label || '',
  artist_ids: [placeholderId],
  name: c.name || '',
  role: c.role || '',
  email: c.email || '',
  phone: c.phone || '',
  social: c.social || '',
  status: 'cold',
  notes_log: c.notes ? [{ date: new Date().toISOString().slice(0,10), text: c.notes }] : [],
}));
```

- [ ] **Step 7: Update `loadDataLocal()` to handle new fields**

Find `loadDataLocal()` (~line 2280). In the part where contacts are loaded from localStorage, ensure new fields have defaults:
```js
// After loading contacts from localStorage, normalize:
contacts = (parsed.contacts || []).map(c => ({
  ...c,
  status: c.status || 'cold',
  notes_log: Array.isArray(c.notes_log) ? c.notes_log : 
    (c.notes ? [{ date: new Date().toISOString().slice(0,10), text: c.notes }] : []),
}));
```

- [ ] **Step 8: Remove `openContactModal()`, `saveContact()`, and the contact modal HTML**

Delete:
- `openContactModal()` function (~line 2855–2902)
- `saveContact()` function (~line 2904–2937)
- The `<div id="contact-modal" ...>` HTML element (the full contact modal overlay)

- [ ] **Step 9: Start the app and test the full CRUD flow**

```bash
npm start
```
Manual verification:
1. Click "Add contact" row → blank panel opens, name field selected
2. Type name, tab through fields
3. Add a note → note appears with date
4. Click trash icon in panel → confirm dialog → contact removed
5. Scan Web for an artist → scanned contacts have `status: 'cold'` and no notes

- [ ] **Step 10: Commit**

```bash
git add index.html
git commit -m "replace contact modal with inline notes panel add/delete flow"
```

---

## Task 8: Clean Up & Polish

Remove remaining dead code, fix the list-area header buttons, and verify the full app flow end-to-end.

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Remove dead state and functions**

Delete any remaining references to:
- `expandedNotes` Set (no longer used — the old notes accordion was per-artist, not per-contact)
- `toggleNotes()` function
- `updateContactArtistSection()` (already removed in Task 2, confirm it's gone)

- [ ] **Step 2: Update list header — remove sort controls if referencing old card layout**

Check the HTML in the `artist-list` column for any sort buttons or dropdowns that referenced `contactsSortMode` or relied on the card layout. Remove or simplify them so only `sortMode` (name/date/label/custom) remains if still useful, or strip entirely if the compact row list doesn't need them.

- [ ] **Step 3: Remove leftover `.artist-card` CSS**

Search the CSS for `.artist-card` rules that weren't removed in Task 4. Delete them.

- [ ] **Step 4: Verify realtime updates work with new fields**

In `loadListArtists()` (~line 2209), the realtime subscription for contacts calls `render()` on changes. Confirm that when a contact is updated via realtime (another device), the `status` and `notes_log` fields come through correctly from Supabase (they will, since `getContacts` does `select('*')`).

- [ ] **Step 5: Full end-to-end test**

```bash
npm start
```
Test checklist:
- [ ] App loads, dashboard shows, list opens
- [ ] Sidebar label filter works (click HYBE → only HYBE artists in list)
- [ ] Artist list shows compact rows with status dots
- [ ] Clicking artist shows workspace with artist name + contact table
- [ ] Status filter pills filter rows correctly
- [ ] Double-clicking a row opens notes panel; double-clicking again closes it
- [ ] ✎ button in row also opens the panel
- [ ] ✉ button opens mailto
- [ ] Inline field edits save on blur
- [ ] Status dot click updates badge in table
- [ ] Add note → timestamped entry appears
- [ ] Add contact → blank panel opens, gets saved
- [ ] Delete contact from panel → removed from table
- [ ] Scan Web still works, scanned contacts appear in table with Cold status
- [ ] ⌘K search still works

- [ ] **Step 6: Final commit**

```bash
git add index.html
git commit -m "v1.1.0 — artist-first redesign: contact table, status system, notes panel"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ 3-column layout (sidebar | artist list | workspace) — Tasks 3
- ✅ Labels view removed — Task 2
- ✅ Artist list compact rows + status dot — Task 4
- ✅ Workspace: artist header + status pills + contact table — Task 5
- ✅ Notes panel: double-click open/close — Tasks 5+6
- ✅ Notes panel: inline editing — Task 6
- ✅ Notes panel: status dots, quick actions — Task 6
- ✅ Notes panel: timestamped notes log, + Add note — Task 6
- ✅ Contact add flow via panel — Task 7
- ✅ Contact delete from panel — Task 7
- ✅ `status` + `notes_log` fields on new/scanned contacts — Task 7
- ✅ DB migration — Task 1
- ✅ Close panel on artist switch — Task 5 (`selectArtist` update)
- ✅ Edit icon opens panel (same as double-click) — Task 5 event handler

**Type consistency check:**
- `contact.status` — string, values: `'cold' | 'reached_out' | 'in_convo' | 'placed'`
- `contact.notes_log` — array of `{ date: string, text: string }`
- `selectedContactId` — string uuid or null, used in Tasks 5–7
- `wsStatusFilter` — string, values: `'all' | 'cold' | 'reached_out' | 'in_convo' | 'placed'`
- `statusLabel(s)` — helper defined in Task 5, used in Tasks 5+6
- `artistStatusDot(artistId)` — helper defined in Task 4, used in Task 4
- `toggleNotesPanel(contactId)` — defined in Task 5, called from Task 6 panel HTML
- `renderNotesPanel(contact)` — defined in Task 6 (replaces stub from Task 5)
- `saveContactField(id, field, value)` — Task 6
- `setContactStatus(id, status)` — Task 6
- `showAddNoteInput(id)` / `saveNote(id, text)` — Task 6
