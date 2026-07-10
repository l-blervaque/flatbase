# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**flatbase** — a single-file HTML database viewer. Renders a database schema as a split-view: sidebar table list + force-directed SVG ER diagram. JSON is the source of truth, inlined directly into the HTML; zero runtime dependencies.

## Architecture

Two files at the repo root:

- **`db-viewer.html`** — viewer (vanilla JS + SVG, no build step).
- **`tables.json`** — pure JSON schema, loaded by the viewer at first run. **Gitignored.** A committed `tables.json.example` provides a small sample (bookstore schema) that exercises every relation type and node style. First-time setup: `cp tables.json.example tables.json`.

The viewer accepts **two input shapes** (see `docs/FORMAT.md` for the spec):
1. A **single bundled JSON file** (canonical shape).
2. A **multi-file folder drop** (`index.json` + per-domain files + optional `enums.json`) — bundled in-memory at load.

Both normalize to the same internal shape. `docs/FORMAT.md` is the reference doc to hand to an LLM when generating new tables.

**Two runtime modes:**
- **Atelier** (default) — open `db-viewer.html` directly; the picker prompts for a file/folder, the normalized result is cached in `localStorage`, and `↻ Data` clears it.
- **Frozen** — when `window.__BAKED_DATA__` is set before the main script runs, `loadData()` normalizes it and returns it. The `↻ Data` button is hidden. This is the runtime the `↓ Export` button produces: a self-contained HTML with the schema inlined, shareable anywhere (file://, GitHub Pages, etc.), locked to that schema. The export bakes the **pristine** input (`RAW_INPUT`, pre-normalize) and re-normalizes at load, so the `↓ Proposal` export round-trips cleanly from frozen viewers too.

**HARD RULE:** flatbase is HTML + JSON, zero external dependencies. Never rename `tables.json` to `.js` or wrap it in a JS assignment to dodge `file://` CORS — the JSON file stays a JSON file.

Inside the HTML:

- `DATA` is `null` at script start and populated by `init()`. **Loading model**: the viewer runs on `file://` (no server), so it cannot `fetch()` the JSON. Instead, the (already-normalized) JSON is cached in **`localStorage`** under key `flatbase.tables.json`. On first run (or after a manual reset), `pickFile()` shows a drag-drop overlay accepting either a single `tables.json` or a `schema/` folder (multi-file layout, walked via `webkitGetAsEntry`). `normalizeData()` bundles + derives relations (from `columns[].fk` / `polymorphic`) and the result is stashed in `localStorage`.
- The header **`↻ Data`** button clears the cache and triggers the picker again — use it when `tables.json` on disk has changed.
- Domain ordering and colors come from `DATA.domains` (an ordered list of `{id, color}`).
- **Two view modes** — a header segmented toggle **Conceptual | Logical** (`viewMode`, `switchViewMode()`). Conceptual = the compact node (name + type badge). Logical = an ER-style box per table: domain-tinted header band (name + small `name_ja`), one row per column with a `PK` (gold) / `FK` (blue) badge + zebra stripes, capped at **12 rows** with a final `… +N more` summary row (rows ordered PK → FK → rest so key columns survive the cap; `logicalRows`/`logicalRowCY`). Proposed columns violet, `status: inferred` italic, arb-ignored struck through; no `columns` → header-only box. `viewMode` persists under `flatbase.viewmode` — a viewing preference **NOT cleared by `↻ Data` or Reset**. Mode switch = load/compute the per-mode layout + re-render + Fit. The toggle also ships in the frozen export.
- **Layout** — Fruchterman-Reingold hub-and-spoke "stars": FR repulsion/attraction with the highest-degree node pinned at origin, temperature annealing, then overlap resolution + component packing + isolated-node parking (`computePositions`). **Deterministic** — a seeded RNG (mulberry32, reset before layout) covers every jitter path, so two loads produce identical positions. Layout uses per-node `nodeWidth(t)`/`nodeHeight(t)` (constants in conceptual; `LOG_W` × row-count-dependent height in logical) and a 1.7 spread factor in logical mode. Positions are **persisted per mode** to `localStorage` under `flatbase.layout.<meta.project>.<schema-signature>` (conceptual keeps the bare key; logical appends a `.logical` suffix — see `layoutKey()`; the signature is a hash of the sorted table ids, so adding/removing tables invalidates a stale layout). `applyLayout()` loads a saved map if it covers every current node id, else recomputes and saves. Node drag rewrites positions and re-saves. `↻ Data` and Reset both clear the saved layout (Reset then recomputes and re-fits — but keeps the view mode). Positions are **world** coordinates centered at origin; screen placement is done by the viewport transform + Fit (there is no `setSVGSize`).
- **Render pipeline** — `render()` clears the SVG and rebuilds `<g id="viewport"><g id="edge-layer">…</g><g id="node-layer">…</g></g>` (visible edges then visible nodes); listeners re-attach per render. Called on any state change. Node drag is the exception — it rewrites only the dragged node's transform + its incident edge paths (rAF-throttled), full `render()` on drop.
- **State** (in-memory, resets on reload unless noted):
  - `hiddenNodes: Set<id>`, `cascadeHiddenNodes: Set<id>`
  - `hiddenDomains: Set<domain>`
  - `proposedFilter: 'all' | 'proposed' | 'defined'`
  - `sidebarSearch: string`, `highlightedNode: id | null`
  - `focusedNode: id | null`, `focusedEdge: {from,to} | null` (click-focus dim state)
  - `panX, panY, zoomK` (viewport transform); `spaceDown`, `panning`, `dragNode` (active gestures)
  - **Persisted exceptions** (survive reload, both cleared by `↻ Data`): `arbitration` (proposal-mode decisions) under `flatbase.arbitration.<meta.project>`, and **layout positions** under `flatbase.layout.<meta.project>.<schema-signature>[.logical]` (one entry per view mode).
  - `viewMode: 'conceptual' | 'logical'` — persisted under `flatbase.viewmode`; **NOT** cleared by `↻ Data` or Reset (it's a viewing preference, not schema state).
- **Interactions**:
  - Domain checkbox → toggles all tables in that domain + their edges.
  - Node click → **focus**: dims everything outside the node's neighborhood (`.dim`) and opens the detail panel. (No cascade-hide on click.)
  - Edge click → focus its two endpoints + itself (wide transparent hit path per edge). In logical mode, focus additionally lights the anchored FK/PK rows (`.row-hi`: amber row rect + bold name) — edge focus lights both endpoints' rows, node focus lights every visible incident edge's rows; `anchorColName()` is the single resolver shared by geometry and highlight.
  - Node drag → repositions the node (persisted to the layout key); a 4px threshold separates click from drag so a drag never opens the panel.
  - Hiding a table → sidebar **eye toggle** or the detail-pane **Hide** button; both keep the cascade-hide of nodes left disconnected from the main component.
  - Sidebar row click → focus the node + pan-to-center it via the viewport (no container scroll). FK badge click navigates + recenters likewise.
  - Background click or **Escape** → clears focus (Escape also closes an open panel).
  - Pan/zoom: wheel = 2D pan (shift = horizontal), ctrl/⌘+wheel = zoom at cursor, Space-hold or right-drag = hand tool, **Fit** button frames the visible graph.
  - Reset → restores all in-memory state, clears focus, recomputes + re-saves the layout, and Fits. Keeps the current view mode.

Node visuals encode domain (fill color), type (badge), `modeled` status (solid vs dashed border — no textual label), and free-form `tags` (gray `#tag` chips/labels; conceptual mode — logical nodes show the column rows instead). Edge visuals encode relation type via **crow's-foot** end marks — fork = "many", tick = "one" — on `has_many` (tick at parent, fork at child), `has_one` (tick/tick) and `many_to_many` (fork/fork); `extends` and `polymorphic` keep their dashed/dotted arrows; `belongs_to` is never drawn. In **logical mode**, edges are **field-anchored** — but only relations carrying `via`/`viaTable`, i.e. those **derived** from `columns[].fk`/`polymorphic`: the FK end anchors at its column's row (L/R side by relative position; capped columns anchor at the `… +N` row), the other end at the target's first PK row (header band if none). Explicit `relations` entries anchor header-to-header even when FK columns exist as rows. Crow's-foot marks render at the row anchors; self-loops stay at the box's right side (see `docs/FORMAT.md` § Edge rendering / § Logical mode rendering and `docs/superpowers/plans/2026-07-10-logical-mode.md`).

## Running / developing

No build/test/lint tooling.

```sh
cp tables.json.example tables.json   # first time only
```

Then open `db-viewer.html` in a browser. Edit the HTML or `tables.json`, reload.

## Conventions

- **Keep it dependency-free.** Viewer is a single HTML file + a JSON sidecar. Don't introduce bundlers, npm, frameworks, or external CDN imports unless explicitly asked.
- **`tables.json` is gitignored**; never commit it. Sample data goes in `tables.json.example`.
- **Schema shape** — see `docs/FORMAT.md`. Quick summary: `{ meta, domains?: [{id, color}], enums?, tables: [{id, name, name_ja?, domain, type, status? | modeled?, tags?: [string], notes?, columns?: [...], relations?: [...] }] }`. `domains` is optional (auto-derived from tables in insertion order + default palette). `relations` is optional — derived from `columns[].fk` and `columns[].polymorphic` when omitted.
- **Relation types**: `belongs_to`, `has_one`, `has_many`, `many_to_many`, `extends`, `polymorphic` (uses `targets: [...]` instead of `target`; `"*"` means all tables).
- **Columns** (optional, per table) — rendered in the detail panel when present. Each entry is either a plain string (just the name) or an object: `{ name, type?, nullable?, pk?, fk?, unique?, enum_ref?, polymorphic?, notes? }`. `fk` is either a string (`"other_table_id"`) or an object (`{ table, column?, on_delete? }`); both produce a clickable badge that navigates to the target table.
- **Out of scope** for the viewer: editing the data (the schema is read-only; arbitration decisions are the only exception), filtering by type/modeled. Push back if asked to add these without context. **In scope by design** (revised 2026-07-09, see `docs/superpowers/plans/2026-07-09-graph-interaction.md`): zoom/pan, drag-to-reposition, and layout persistence — these were on the original spec's out-of-scope list but were adopted deliberately. **Exception — proposal-arbitration mode**: the proposed filter, per-element arbitration (ignore / type overrule) and its localStorage persistence are in scope by design (see `docs/FORMAT.md` § Arbitration).
- **No literal `</script>` in the viewer's script body.** The whole viewer lives inside one inline `<script>` tag, so the HTML parser is in script-data state while scanning it. Any literal `<` + `/script>` byte sequence — even inside a JS comment or a template literal — ends the script tag prematurely and breaks the source viewer. Regex literals like `/<\/script>/gi` are safe (the `\` between `<` and `/` prevents the match). When the output of `buildFrozenHTML` needs to embed real closing-script tags, build them at runtime via `const SC = '</' + 'script>'` and interpolate `${SC}` into the template.

## Reference docs

- `docs/FORMAT.md` — canonical schema format (single-file + multi-file folder layout). Hand this to an LLM to generate new tables.
- `docs/superpowers/specs/2026-05-12-db-viewer-design.md` — original design spec (layout, node/edge visuals, interactions, out-of-scope list).
- `docs/superpowers/plans/2026-05-12-db-viewer.md` — implementation plan that built the current viewer.
- `docs/superpowers/specs/2026-05-21-export-frozen-html-design.md` — design spec for the ↓ Export / frozen-HTML feature.
- `docs/superpowers/plans/2026-05-21-export-frozen-html.md` — implementation plan for the same.
- `docs/proposed-fixture.json` — minimal fixture exercising the `proposed` marker, `_evidence`/`_provenance`/`_home` metadata, proposed FK edges, and a proposed enum.
