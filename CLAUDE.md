# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**flatbase** — a single-file HTML database viewer. Renders a database schema as a split-view: sidebar table list + force-directed SVG ER diagram. JSON is the source of truth, inlined directly into the HTML; zero runtime dependencies.

## Architecture

Two files at the repo root:

- **`db-viewer.html`** — viewer (vanilla JS + SVG, no build step).
- **`tables.json`** — pure JSON schema, fetched by the viewer at load. **Gitignored.** A committed `tables.json.example` provides a small sample (bookstore schema) that exercises every relation type and node style. First-time setup: `cp tables.json.example tables.json`.

**HARD RULE:** flatbase is HTML + JSON, zero external dependencies. Never rename `tables.json` to `.js` or wrap it in a JS assignment to dodge `file://` CORS — the JSON file stays a JSON file.

Inside the HTML:

- `DATA` is `null` at script start and populated by `init()`. **Loading model**: the viewer runs on `file://` (no server), so it cannot `fetch()` the JSON. Instead, the JSON content is cached in **`localStorage`** under key `flatbase.tables.json`. On first run (or after a manual reset), `pickFile()` shows a drag-drop overlay; the user drops `tables.json` (or clicks to pick it), `FileReader` parses it, and it's stashed in `localStorage`. Subsequent reloads are instant.
- The header **`↻ Data`** button clears the cache and triggers the picker again — use it when `tables.json` on disk has changed.
- Domain ordering and colors come from `DATA.domains` (an ordered list of `{id, color}`).
- **Layout** — force-directed graph: pairwise repulsion + spring edges + center pull, run for a fixed number of iterations at load (`computePositions`, ~line 858). Positions are static after load.
- **Render pipeline** — `render()` clears the SVG, then draws visible edges then visible nodes. Called on any state change.
- **State** (in-memory only, resets on reload):
  - `hiddenNodes: Set<id>`
  - `hiddenDomains: Set<domain>`
  - `highlightedNode: id | null`
- **Interactions**:
  - Domain checkbox → toggles all tables in that domain + their edges.
  - Node click → hides node, then cascade-hides any node no longer connected to the main component.
  - Sidebar click → highlights node + scrolls SVG to it.
  - Reset → restores all state.

Node visuals encode domain (fill color), type (badge), and `modeled` status (solid vs dashed border). Edge visuals encode relation type (see `docs/superpowers/specs/2026-05-12-db-viewer-design.md` for the full mapping).

## Running / developing

No build/test/lint tooling.

```sh
cp tables.json.example tables.json   # first time only
```

Then open `db-viewer.html` in a browser. Edit the HTML or `tables.json`, reload.

## Conventions

- **Keep it dependency-free.** Viewer is a single HTML file + a JSON sidecar. Don't introduce bundlers, npm, frameworks, or external CDN imports unless explicitly asked.
- **`tables.json` is gitignored**; never commit it. Sample data goes in `tables.json.example`.
- **Schema shape** (`tables.json`): `{ meta, domains?: [{id, color}], tables: [{id, name, name_ja, domain, type, modeled, notes?, relations: [...], columns?: [...]}] }`. `domains` is optional — when absent, the loader auto-derives it from tables (insertion order, default palette).
- **Relation types**: `belongs_to`, `has_one`, `has_many`, `many_to_many`, `extends`, `polymorphic` (uses `targets: [...]` instead of `target`; `"*"` means all tables).
- **Columns** (optional, per table) — rendered in the detail panel when present. Each entry is either a plain string (just the name) or an object: `{ name, type?, nullable?, pk?, fk?, unique?, notes? }`. `fk: "<other_table_id>"` becomes a clickable badge that navigates to that table.
- **Out of scope** for the viewer (per design spec): zoom/pan, drag-to-reposition, persistence, editing the data, filtering by type/modeled. Push back if asked to add these without context.

## Reference docs

- `docs/superpowers/specs/2026-05-12-db-viewer-design.md` — original design spec (layout, node/edge visuals, interactions, out-of-scope list).
- `docs/superpowers/plans/2026-05-12-db-viewer.md` — implementation plan that built the current viewer.
