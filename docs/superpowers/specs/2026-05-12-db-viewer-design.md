# DB Viewer — Design Spec

> **Superseded (2026-07-09) — interaction model.** The "out of scope" list below
> (zoom/pan, drag-to-reposition, persistence) and the original static-layout /
> hide-on-click / scroll-to-node interactions were revised by operator decision.
> The current interaction model — Fruchterman-Reingold hub-and-spoke layout,
> persisted positions, viewport pan/zoom + Fit, node drag, focus (dim) mode, and
> crow's-foot cardinality — is specified in
> `docs/superpowers/plans/2026-07-09-graph-interaction.md`. This document is kept
> as the historical record; do not read its interaction/out-of-scope sections as
> current behaviour.

**Date:** 2026-05-12  
**Scope:** Single-file HTML/JS/CSS tool to visualize `tables.json`

---

## Goal

Replace ad-hoc Markdown conversions of `tables.json` with a self-contained browser tool that renders the full flatbase DB schema as a split view (table list + ER diagram).

---

## Architecture

Single file: `docs/architecture/db-viewer.html`  
Zero external dependencies. JSON data inlined in the file as a JS constant.

---

## Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  flatbase  v0.5   [domain checkboxes…]       [Reset]   │
├──────────────────┬──────────────────────────────────────────────┤
│  SIDEBAR (~280px)│  SVG DIAGRAM (remaining width, h-scroll)     │
│                  │                                               │
│  [commercial]    │  columns per domain, left→right              │
│  > Partner       │  all tables visible by default               │
│  > Partner-Hall  │                                               │
│  ...             │                                               │
│  [hr]            │                                               │
│  > Employee      │                                               │
└──────────────────┴──────────────────────────────────────────────┘
```

- **Header (fixed):** domain filter checkboxes (one per domain, color-coded) + Reset button
- **Sidebar:** tables grouped by domain, click highlights the node in the diagram
- **SVG area:** horizontal scroll if needed; all nodes rendered at load

---

## Nodes (SVG rect)

Each table is a rectangle containing:
- **Name EN** (bold)
- **Name JP** (small, gray)
- **Type badge** (entity / extension / cross-cutting / reference)
- **Fill color** by domain (7 colors)
- **Border style:** solid if `modeled: true`, dashed if `modeled: false`

---

## Edges (SVG lines)

Drawn between nodes based on the `relations` array. Style by relation type:

| Type | Visual |
|------|--------|
| `belongs_to`, `has_one`, `has_many` | solid line + arrowhead |
| `many_to_many` | solid line + double arrowhead |
| `extends` | dashed line + arrowhead |
| `polymorphic` | dotted line to each target |

Labels (from `label` field if present, otherwise relation type) rendered mid-edge.

---

## Layout Algorithm

Columns by domain, left to right: commercial → hr → operations → coordination → customer → cross-cutting → reference.  
Within each column, tables stacked vertically with fixed spacing.  
Positions computed once at load, static thereafter.

---

## Interactions

### Domain filter (checkboxes in header)
- Toggling a domain OFF hides all its tables (nodes) and all edges connected to those nodes (both directions).
- Toggling ON restores them (unless a node was individually hidden via cascade).

### Node hiding (click on node)
- Clicking a visible node hides it.
- After hiding, the JS computes connected components among the remaining visible nodes.
- Any node no longer reachable from the main graph (isolated) is also hidden.
- Edges to/from hidden nodes are hidden.

### Sidebar click
- Clicking a table in the sidebar highlights the corresponding node (accent border color) and scrolls the SVG to bring it into view.

### Reset button
- Restores all nodes to visible, re-enables all domain checkboxes, clears any highlight.

---

## Data Flow

```
tables.json (inline JS const)
  → parse at load
  → build node map + adjacency list
  → compute SVG positions (columns × rows)
  → render nodes + edges
  → attach event listeners (checkboxes, node clicks, sidebar clicks, reset)
  → on state change: recompute visible set → re-render
```

---

## Out of Scope

- Zoom / pan
- Drag to reposition nodes
- Persistence across reloads
- Filtering by type or modeled status
- Editing the data
