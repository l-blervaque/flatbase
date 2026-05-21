# Export frozen HTML Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `↓ Export` button that downloads a self-contained HTML file with the current schema baked in, openable anywhere with no setup and locked to that schema.

**Architecture:** Single-file zero-dep viewer, no build, no test framework. All changes are in `db-viewer.html`. The exported HTML reuses the source file's `<style>` and main `<script>` verbatim (read from the live document), and prepends a `<script>` block that sets `window.__BAKED_DATA__`. At load time, `loadData()` short-circuits to that global if present, skipping the picker and localStorage.

**Tech Stack:** Vanilla JS, SVG, `Blob` + `URL.createObjectURL` for download. No external deps.

**Verification model:** No test framework exists in this repo. Each task ends with **manual smoke tests** in a browser plus a commit. Expected results are listed explicitly so the engineer can confirm without ambiguity.

---

## File Structure

- **`db-viewer.html`** — all logic lives here. Three discrete additions, kept separated by clear section comments:
  1. **Baked-mode short-circuit** in `loadData()` and `init()` (~5 LoC).
  2. **`↓ Export` button** in the `#header` markup (1 element).
  3. **`exportFrozenHTML()` function** with helpers `slugifyMeta()` and `buildFrozenHTML()` (~60 LoC, contiguous block).
- **`CLAUDE.md`** — one paragraph documenting the dual atelier/frozen mode.

No new files. No directory changes.

---

## Task 1: Baked-mode short-circuit

Add the `window.__BAKED_DATA__` detection first. This is the smallest change and the foundation: once landed, an exported HTML produced manually (or by a later task) will already work.

**Files:**
- Modify: `db-viewer.html` (the `loadData()` function and the `init()` function)

- [ ] **Step 1: Modify `loadData()` to check `window.__BAKED_DATA__` first**

Locate the current `loadData()` (near the bottom of the `<script>` block):

```js
async function loadData() {
  const cached = loadCachedData();
  if (cached) {
    try { return normalizeData(cached); }
    catch { /* fall through to picker if cache is unparseable */ }
  }
  return await pickFile();
}
```

Replace with:

```js
async function loadData() {
  if (window.__BAKED_DATA__) {
    // Baked HTML: data is inlined, skip cache and picker entirely.
    return normalizeData(window.__BAKED_DATA__);
  }
  const cached = loadCachedData();
  if (cached) {
    try { return normalizeData(cached); }
    catch { /* fall through to picker if cache is unparseable */ }
  }
  return await pickFile();
}
```

- [ ] **Step 2: Hide `↻ Data` button in baked mode**

In `init()`, locate this line:

```js
  document.getElementById('reload-data-btn').addEventListener('click', clearCachedData);
```

Replace with:

```js
  const reloadBtn = document.getElementById('reload-data-btn');
  if (window.__BAKED_DATA__) {
    reloadBtn.style.display = 'none';
  } else {
    reloadBtn.addEventListener('click', clearCachedData);
  }
```

- [ ] **Step 3: Smoke test — atelier mode unchanged**

Open `db-viewer.html` in a browser (cache already populated from the existing `tables.json`).

Expected:
- Viewer loads normally with the current schema.
- `↻ Data` button is visible in the header.
- Clicking `↻ Data` still clears cache and re-prompts for a file.

- [ ] **Step 4: Smoke test — manually fake baked mode**

In the browser DevTools, **before** the page loads (use the "Sources" tab → set a breakpoint on the first line of the inline script, OR use the URL-bar-bookmarklet trick), set:

```js
window.__BAKED_DATA__ = JSON.parse(localStorage.getItem('flatbase.tables.json'));
localStorage.removeItem('flatbase.tables.json');
```

Easier alternative — use a temporary edit: just above `async function init() {` in the script, temporarily add:

```js
window.__BAKED_DATA__ = JSON.parse(localStorage.getItem('flatbase.tables.json'));
localStorage.removeItem('flatbase.tables.json');
```

Reload. Expected:
- Viewer renders the schema.
- `↻ Data` button is hidden.
- `localStorage` no longer holds the schema (verify in DevTools → Application → Local Storage).

Remove the temporary edit. Reload. Expected: drop-picker overlay appears (cache is empty). Drop `tables.json`. Cache repopulates. Viewer renders.

- [ ] **Step 5: Commit**

```bash
git add db-viewer.html
git commit -m "feat(viewer): support baked __BAKED_DATA__ mode

When window.__BAKED_DATA__ is defined before the main script runs,
loadData() returns it directly and the ↻ Data button is hidden. This
is the runtime half of the upcoming Export frozen HTML feature."
```

---

## Task 2: Export button markup

Add the `↓ Export` button to the header. Wire it to a placeholder that throws — the actual implementation comes in Task 3. Splitting these tasks isolates the UI plumbing from the export logic.

**Files:**
- Modify: `db-viewer.html` (`#header` section, around lines 320-325)

- [ ] **Step 1: Add the button to the header markup**

Locate the header markup:

```html
<header id="header">
  <span class="app-title">flatbase <small>v0.5</small></span>
  <div id="domain-filters"></div>
  <button id="reset-btn">Reset</button>
  <button id="reload-data-btn" title="Load a different tables.json">↻ Data</button>
</header>
```

Insert the Export button to the right of `↻ Data` (so it remains rightmost in baked mode, where `↻ Data` is hidden):

```html
<header id="header">
  <span class="app-title">flatbase <small>v0.5</small></span>
  <div id="domain-filters"></div>
  <button id="reset-btn">Reset</button>
  <button id="reload-data-btn" title="Load a different tables.json">↻ Data</button>
  <button id="export-btn" title="Download a standalone HTML viewer with this schema baked in">↓ Export</button>
</header>
```

- [ ] **Step 2: Add the Export button selector to the existing button CSS rule**

Locate the existing rule:

```css
    #reset-btn, #reload-data-btn {
      background: #313244;
      color: #cdd6f4;
      border: 1px solid #45475a;
      padding: 4px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      white-space: nowrap;
    }
    #reset-btn:hover, #reload-data-btn:hover { background: #45475a; }
```

Replace with (adds `#export-btn` to both selectors):

```css
    #reset-btn, #export-btn, #reload-data-btn {
      background: #313244;
      color: #cdd6f4;
      border: 1px solid #45475a;
      padding: 4px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      white-space: nowrap;
    }
    #reset-btn:hover, #export-btn:hover, #reload-data-btn:hover { background: #45475a; }
```

- [ ] **Step 3: Wire the button to a stub in `init()`**

Locate this line in `init()`:

```js
  document.getElementById('reset-btn').addEventListener('click', resetState);
```

Add immediately after it:

```js
  document.getElementById('export-btn').addEventListener('click', exportFrozenHTML);
```

- [ ] **Step 4: Add a temporary stub `exportFrozenHTML()` so the page doesn't error**

Add this near the other top-level helpers, e.g. just above `async function loadData() {`:

```js
function exportFrozenHTML() {
  alert('export: not implemented yet');
}
```

- [ ] **Step 5: Smoke test**

Reload `db-viewer.html`. Expected:
- Three buttons in the header: `Reset`, `↓ Export`, `↻ Data`.
- All three styled identically.
- Hovering Export shows the tooltip.
- Clicking Export shows the `not implemented yet` alert.

- [ ] **Step 6: Commit**

```bash
git add db-viewer.html
git commit -m "feat(viewer): add ↓ Export button (stub)

Wires the button into the header with the same styling as the other
header controls. Click handler is a stub; the real export logic lands
in the next commit."
```

---

## Task 3: `exportFrozenHTML()` implementation

Replace the stub with the real implementation. Composes a new HTML using the live document's `<style>` and `<script>` plus a hardcoded body skeleton, prepends a `<script>` block setting `window.__BAKED_DATA__`, and triggers a download.

**Files:**
- Modify: `db-viewer.html` (replace the stub from Task 2)

- [ ] **Step 1: Implement `slugifyMeta()`**

Replace the stub `exportFrozenHTML` (and surrounding) with the helpers below.

Add this helper just above `function exportFrozenHTML() { ... }`:

```js
function slugifyMeta(meta) {
  const src = (meta && (meta.version || meta.scope)) || 'schema';
  return String(src)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'schema';
}
```

- [ ] **Step 2: Implement `buildFrozenHTML()`**

Add this helper just below `slugifyMeta`:

```js
// Produces a self-contained HTML string that, when opened, runs the same
// viewer with DATA baked in as window.__BAKED_DATA__. Reads the live
// document's <style> and main <script> so the output stays in sync with
// the source file automatically.
function buildFrozenHTML(data) {
  const styleText  = document.querySelector('style').textContent;
  const scriptText = document.querySelector('script').textContent;
  const slug       = slugifyMeta(data.meta);
  const title      = data.meta && (data.meta.scope || data.meta.version)
    ? `flatbase — ${slug}`
    : 'flatbase';

  // Escape </script> in the JSON so the inline data block can't be
  // closed prematurely by user-authored strings.
  const jsonText = JSON.stringify(data).replace(/<\/script>/gi, '<\\/script>');

  // Hardcoded body skeleton — must match the source file's <body> markup
  // (minus runtime-injected children). Keep in sync if the source body
  // structure changes.
  const bodyMarkup = `
<header id="header">
  <span class="app-title">flatbase <small>v0.5</small></span>
  <div id="domain-filters"></div>
  <button id="reset-btn">Reset</button>
  <button id="reload-data-btn" title="Load a different tables.json">↻ Data</button>
  <button id="export-btn" title="Download a standalone HTML viewer with this schema baked in">↓ Export</button>
</header>

<div id="main">
  <nav id="sidebar"></nav>
  <div id="diagram-wrap">
    <svg id="diagram">
      <defs id="svg-defs"></defs>
    </svg>
  </div>
</div>

<aside id="detail-panel" class="closed">
  <header>
    <h2 id="detail-name-en"></h2>
    <button id="detail-close" aria-label="Close">×</button>
  </header>
  <div id="detail-body"></div>
</aside>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>${styleText}</style>
</head>
<body>
${bodyMarkup}
<script>window.__BAKED_DATA__ = ${jsonText};</script>
<script>${scriptText}</script>
</body>
</html>
`;
}
```

- [ ] **Step 3: Replace the stub `exportFrozenHTML`**

Replace the stub:

```js
function exportFrozenHTML() {
  alert('export: not implemented yet');
}
```

With the real implementation:

```js
function exportFrozenHTML() {
  if (!DATA) return;
  const html = buildFrozenHTML(DATA);
  const blob = new Blob([html], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `flatbase-${slugifyMeta(DATA.meta)}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Smoke test — export and re-open the result**

1. Open `db-viewer.html` in a browser. Confirm the schema loads.
2. Click `↓ Export`. A file `flatbase-<slug>.html` downloads.
3. Open the downloaded file directly (double-click, `file://`).

Expected:
- Viewer renders the same schema as the atelier.
- `Reset` and `↓ Export` buttons are visible.
- `↻ Data` button is **hidden**.
- `localStorage['flatbase.tables.json']` is **empty** in that file's context (verify in DevTools).
- Clicking nodes, filtering domains, hiding nodes, opening detail panel, FK navigation — all work.
- Browser tab title contains the slug (or just "flatbase" if no `meta`).

- [ ] **Step 5: Smoke test — `</script>` escaping**

In the atelier `tables.json`, temporarily add a column with a description containing `</script>`:

```json
{ "name": "evil_col", "type": "text", "notes": "this contains </script> in the middle" }
```

Reload (`↻ Data` → drop), then click `↓ Export`. Open the resulting HTML.

Expected: viewer still loads correctly; opening the detail panel for the table with `evil_col` shows the literal text `this contains </script> in the middle` in the notes.

Remove the temporary column from `tables.json` after verifying.

- [ ] **Step 6: Smoke test — idempotent re-export from a frozen HTML**

Open the previously downloaded `flatbase-<slug>.html`. Click `↓ Export`. A second file downloads. Open it.

Expected: identical behavior — same schema, no `↻ Data`, all interactions work.

- [ ] **Step 7: Commit**

```bash
git add db-viewer.html
git commit -m "feat(viewer): implement frozen HTML export

↓ Export composes a self-contained HTML by reusing the live <style>
and <script>, a hardcoded body skeleton, and an inlined
window.__BAKED_DATA__ block. </script> sequences inside the JSON are
escaped to prevent premature tag closure. The downloaded file works
in file:// and on any static host, and is locked to its schema."
```

---

## Task 4: Document the feature in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a short section explaining the two modes**

Locate this paragraph in `CLAUDE.md` (under the `## Architecture` section):

```markdown
The viewer accepts **two input shapes** (see `docs/FORMAT.md` for the spec):
1. A **single bundled JSON file** (canonical shape).
2. A **multi-file folder drop** in the multi-file layout (`index.json` + per-domain files + optional `enums.json`) — bundled in-memory at load.

Both normalize to the same internal shape. `docs/FORMAT.md` is the reference doc to hand to an LLM when generating new tables.
```

Add immediately after it:

```markdown
**Two runtime modes:**
- **Atelier** (default) — open `db-viewer.html` directly; the picker prompts for a file/folder, the normalized result is cached in `localStorage`, and `↻ Data` clears it.
- **Frozen** — when `window.__BAKED_DATA__` is set before the main script runs, `loadData()` returns it directly. The `↻ Data` button is hidden. This is the runtime the `↓ Export` button produces: a self-contained HTML with the schema inlined, shareable anywhere (file://, GitHub Pages, etc.), locked to that schema.
```

- [ ] **Step 2: Add a pointer to the new spec under Reference docs**

Locate the `## Reference docs` section. Currently:

```markdown
## Reference docs

- `docs/FORMAT.md` — canonical schema format (single-file + multi-file folder layout). Hand this to an LLM to generate new tables.
- `docs/system-schema-structure.md` — notes on the upstream multi-file format that inspired the canonical shape.
- `docs/superpowers/specs/2026-05-12-db-viewer-design.md` — original design spec (layout, node/edge visuals, interactions, out-of-scope list).
- `docs/superpowers/plans/2026-05-12-db-viewer.md` — implementation plan that built the current viewer.
```

Add these two lines at the end of that list:

```markdown
- `docs/superpowers/specs/2026-05-21-export-frozen-html-design.md` — design spec for the ↓ Export / frozen-HTML feature.
- `docs/superpowers/plans/2026-05-21-export-frozen-html.md` — implementation plan for the same.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: describe atelier vs frozen runtime modes

CLAUDE.md now flags the two ways the viewer runs and points at the
spec + plan for the Export feature."
```

---

## Final verification

- [ ] **End-to-end smoke walkthrough**

1. Fresh atelier — clear cache via `↻ Data`, drop `tables.json`, confirm load.
2. Export — click `↓ Export`, save the downloaded file.
3. Open exported file — double-click, confirm: schema renders, `↻ Data` hidden, `Reset` works, `↓ Export` still present.
4. Re-export from the frozen file — confirm output is functionally identical.
5. Atelier still works — open `db-viewer.html` again, cache still loads instantly, `↻ Data` visible.

All five must pass before considering the feature complete.
