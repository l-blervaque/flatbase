# Export frozen HTML — design

**Date:** 2026-05-21
**Status:** approved

## Intention

flatbase has two modes today: drag-drop in `file://` (atelier) and (planned) serving over HTTP. This feature adds a third use case: **producing a self-contained HTML artifact** that bundles the currently loaded schema.

The exported file:

- Opens anywhere with zero setup — `file://`, GitHub Pages, email, Slack share.
- Contains exactly the schema that was loaded in the atelier at export time, inlined as JSON.
- Is **locked to that schema** (no drop, no localStorage cache, no `↻ Data` button).
- Keeps all read-side affordances: navigation, hiding nodes, domain filters, detail panel, `Reset`.

The atelier (`db-viewer.html` with no baked data) and the exported viewer share the **same source**. They differ only in whether `window.__BAKED_DATA__` is set before the main script runs.

## Why this matters

Today, sharing a schema means either (a) sending two files (HTML + JSON) and explaining how to drop one into the other, or (b) running a local web server. Neither is appealing. The exported HTML is a single artifact — diff-able in git, hostable anywhere, openable by double-click.

This also enables a natural versioning workflow: commit the source `tables.json` (or `schema/` folder) **and** the exported `.html` snapshot to git. Each commit becomes a navigable snapshot of the schema at that point in time.

## Components

### 1. Export button

- Location: `#header`, immediately to the right of `↻ Data` (or replacing its position when `↻ Data` is hidden).
- Label: `↓ Export`.
- Tooltip: `Download a standalone HTML viewer with this schema baked in`.
- Visible in both atelier and baked modes (a baked HTML can re-export itself; this is idempotent and useful for the "downstream re-share" case).

### 2. `exportFrozenHTML()`

Reads the current document, composes a new HTML string, downloads it. No fetch, no network — works in `file://`.

Steps:

1. **Capture source** — read the existing `<style>` and the main `<script>` text content via `document.querySelector('style').textContent` and `document.querySelector('script').textContent`. These hold the unmodified viewer source as parsed from disk; runtime DOM mutations do not pollute them.
2. **Serialize data** — `JSON.stringify(DATA)` where `DATA` is the in-memory normalized schema. Apply `</script>` escaping: `.replace(/<\/script>/gi, '<\\/script>')` to prevent the inline data block from closing its own `<script>` tag if a user-authored string ever contains that substring.
3. **Compose HTML** — a single template literal producing:
   ```
   <!DOCTYPE html>
   <html lang="en">
   <head>
     <meta charset="UTF-8">
     <meta name="viewport" content="width=device-width, initial-scale=1.0">
     <title>{{title}}</title>
     <style>{{style}}</style>
   </head>
   <body>
     {{body markup — same as atelier body, copied verbatim}}
     <script>window.__BAKED_DATA__ = {{json}};</script>
     <script>{{main script}}</script>
   </body>
   </html>
   ```
   The body markup is captured by `document.querySelector('body').cloneNode(true)` then stripping any runtime-injected children: the `#data-picker` overlay if present, the dynamically populated children of `#diagram` (`<g>` nodes/edges) and `#sidebar` and `#domain-filters` and `#detail-body`. After scrubbing, `innerHTML` is read. Simpler alternative: hardcode the body skeleton in the export function (same markup as the source file's `<body>` minus dynamic children). The hardcoded approach is preferred — fewer ways to leak runtime state into the output.
4. **Download** — `new Blob([html], { type: 'text/html' })`, `URL.createObjectURL`, anchor with `download="{{filename}}"`, click, revoke URL.

### 3. Baked mode in the viewer

Three small changes to existing code:

- `loadData()` checks `window.__BAKED_DATA__` first. If set, returns it (already normalized, but pass through `normalizeData` defensively — it's idempotent). Skips both `loadCachedData()` and `pickFile()`.
- In `init()`, if `window.__BAKED_DATA__` is set, hide the `↻ Data` button: `document.getElementById('reload-data-btn').style.display = 'none'`.
- The `Reset` button keeps working — it only resets in-memory UI state (hidden nodes, domain filters, highlight). It does not touch the data.

### 4. Filename and title

- Slug source, in order of preference: `DATA.meta.version`, `DATA.meta.scope`, `'schema'`.
- Slug rule: lowercase, non-alphanumeric runs collapsed to `-`, trim leading/trailing `-`.
- Filename: `flatbase-<slug>.html`.
- `<title>` in the exported HTML: `flatbase — <slug>` (or just `flatbase` if no source). Helps the recipient identify the browser tab.

## Data flow

```
[Atelier]  drop file/folder
   → pickFile()
   → normalizeData()
   → localStorage cache + render
   → user clicks ↓ Export
   → exportFrozenHTML()
   → reads style + script from DOM, serializes DATA, composes HTML
   → Blob download

[Recipient]  opens exported HTML
   → script tag sets window.__BAKED_DATA__
   → main script runs
   → loadData() returns __BAKED_DATA__
   → render
   → ↻ Data hidden; everything else works
```

## Out of scope

These are explicit non-goals, kept here to prevent scope drift during implementation:

- **No UI state capture.** Exported HTML always opens on the initial state — all nodes visible, no highlight. Hidden-nodes / domain-off / highlighted-node are not serialized.
- **No checksum, signature, or versioning** of the exported file. It is plain HTML.
- **No two-way import.** There is no "load a baked HTML back into the atelier" action. To re-open an exported schema in the atelier, the user reads the JSON out of the file manually (or just keeps the source `tables.json`).
- **No layout persistence.** Force-directed positions are recomputed on each load, including in baked HTMLs. Layouts will be deterministic given the same input (the simulation is seeded by node ordering, no `Math.random` in the hot path beyond a deterministic tie-break).

  Note: `computePositions` currently calls `Math.random()` once per pair when nodes overlap exactly. This is the only nondeterminism; in practice it is unobservable across loads of identical data. Treating layout persistence as out-of-scope means this is acceptable.

  > **Superseded (2026-07-09).** The graph-interaction work (`docs/superpowers/plans/2026-07-09-graph-interaction.md`) added deterministic Fruchterman-Reingold layout with a seeded PRNG (no `Math.random` anywhere in the layout path) and per-project layout **persistence** (`localStorage` key `flatbase.layout.<project>.<schema-sig>`, saved on drag/reset, cleared by `↻ Data`). Manual arrangements now survive reloads, including in frozen exports. The paragraph above describes the original (pre-interaction) behaviour and is kept for history only.

## Risks and mitigations

| Risk                                                              | Mitigation                                                                                       |
|-------------------------------------------------------------------|--------------------------------------------------------------------------------------------------|
| User-authored string contains `</script>`                         | Escape with `.replace(/<\/script>/gi, '<\\/script>')` before inlining.                           |
| Schema growth makes exported HTML large                           | Acceptable. HTML stays well under 1 MB for realistic schemas (~hundreds of tables).              |
| Future viewer changes break compatibility with old baked HTMLs    | Acceptable. Baked HTMLs are snapshots, not live consumers; each is self-contained at export time.|
| Body-cloning leaks runtime DOM                                    | Use a hardcoded body skeleton in the export function instead of cloning live DOM.                |

## Files touched

- `db-viewer.html` — add `↓ Export` button, `exportFrozenHTML()` function, `__BAKED_DATA__` short-circuit in `loadData()`, conditional hide of `↻ Data`.
- `CLAUDE.md` — short paragraph documenting the feature.
- `docs/FORMAT.md` — no change (format is unchanged).
