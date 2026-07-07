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
- **Layout** — force-directed graph: pairwise repulsion + spring edges + center pull, run for a fixed number of iterations at load (`computePositions`, ~line 858). Positions are static after load.
- **Render pipeline** — `render()` clears the SVG, then draws visible edges then visible nodes. Called on any state change.
- **State** (in-memory only, resets on reload):
  - `hiddenNodes: Set<id>`
  - `hiddenDomains: Set<domain>`
  - `highlightedNode: id | null`
  - `proposedFilter: 'all' | 'proposed' | 'defined'`
  - Exception: `arbitration` (proposal-mode decisions) is the one deliberately *persisted* state — `localStorage` key `flatbase.arbitration.<meta.project>`, cleared by `↻ Data`.
- **Interactions**:
  - Domain checkbox → toggles all tables in that domain + their edges.
  - Node click → hides node, then cascade-hides any node no longer connected to the main component.
  - Sidebar click → highlights node + scrolls SVG to it.
  - Reset → restores all state.

Node visuals encode domain (fill color), type (badge), `modeled` status (solid vs dashed border — no textual label), and free-form `tags` (gray `#tag` chips/labels). Edge visuals encode relation type (see `docs/superpowers/specs/2026-05-12-db-viewer-design.md` for the full mapping).

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
- **Out of scope** for the viewer (per design spec): zoom/pan, drag-to-reposition, persistence, editing the data, filtering by type/modeled. Push back if asked to add these without context. **Exception — proposal-arbitration mode**: the proposed filter, per-element arbitration (ignore / type overrule) and its localStorage persistence are in scope by design (see `docs/FORMAT.md` § Arbitration).
- **No literal `</script>` in the viewer's script body.** The whole viewer lives inside one inline `<script>` tag, so the HTML parser is in script-data state while scanning it. Any literal `<` + `/script>` byte sequence — even inside a JS comment or a template literal — ends the script tag prematurely and breaks the source viewer. Regex literals like `/<\/script>/gi` are safe (the `\` between `<` and `/` prevents the match). When the output of `buildFrozenHTML` needs to embed real closing-script tags, build them at runtime via `const SC = '</' + 'script>'` and interpolate `${SC}` into the template.

## Reference docs

- `docs/FORMAT.md` — canonical schema format (single-file + multi-file folder layout). Hand this to an LLM to generate new tables.
- `docs/superpowers/specs/2026-05-12-db-viewer-design.md` — original design spec (layout, node/edge visuals, interactions, out-of-scope list).
- `docs/superpowers/plans/2026-05-12-db-viewer.md` — implementation plan that built the current viewer.
- `docs/superpowers/specs/2026-05-21-export-frozen-html-design.md` — design spec for the ↓ Export / frozen-HTML feature.
- `docs/superpowers/plans/2026-05-21-export-frozen-html.md` — implementation plan for the same.
- `docs/proposed-fixture.json` — minimal fixture exercising the `proposed` marker, `_evidence`/`_provenance`/`_home` metadata, proposed FK edges, and a proposed enum.
