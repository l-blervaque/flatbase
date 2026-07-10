# Logical mode — table boxes with column rows, field-anchored edges

> Plan (2026-07-10, phase 2 of the graph-interaction effort — see
> `2026-07-09-graph-interaction.md`). Adds the reference viewer's dual
> Conceptual/Logical representation: in Logical mode each table renders its
> columns as rows inside the node, edges anchor to the exact FK field row, and
> focusing a relation highlights the FK/PK rows on both ends.
> Tracked by dev-feedback issue #47.

## Scope

- Header segmented toggle **Conceptual | Logical** (both body skeletons).
- **Logical node**: header band (table name + small name_ja, domain-color
  fill) + one row per column: key badge (`PK` gold / `FK` blue) + column name.
  Zebra stripes. Proposed columns render violet; `status: inferred` italic
  (existing conventions). Tables without `columns` render header-only.
- **Row cap**: display at most 12 column rows; a final `… +N` row summarizes
  the rest (the detail panel remains the full view). Edges anchoring to a
  hidden row anchor to the `… +N` row instead.
- **Field-anchored edges**: a derived edge knows its carrying FK column
  (`via`/`viaTable`) → that end anchors at the column's row (left or right
  node edge by relative position, like the reference `fieldAnchor`). The other
  end anchors at the target's `pk` row when identifiable, else the header.
  Explicit relations without `via` anchor at the header. Crow's-foot marks
  render at the row anchors (outward normal from the L/R side).
- **Focus in logical mode**: focusing an edge (or a node's neighborhood)
  highlights the connected FK/PK rows on both ends (row fill + bold), like the
  reference `setRowHi`.
- **Per-mode layout**: separate persisted positions per mode
  (`flatbase.layout.<project>.<signature>.<mode>`); FR layout uses per-node
  width/height (logical nodes are tall) and a larger spread factor in logical
  mode (reference used SP=1.7). Mode switch = re-render + applyLayout + Fit.
- **Mode state**: `viewMode: 'conceptual' | 'logical'`, persisted under
  `flatbase.viewmode` (a viewing preference — NOT cleared by ↻ Data; Reset
  keeps the mode too). Default: conceptual.
- Everything works in both modes: pan/zoom/drag/focus/crow's-foot, hiding,
  proposed filter, arbitration rendering, tags, sidebar, exports. Frozen
  export carries the toggle (pure view state).

## Non-negotiable constraints

Same as phase 1 (see 2026-07-09 plan): zero deps, no literal closing-script
byte sequence, frozen-skeleton sync, RAW_INPUT purity, deterministic seeded
layout, arbitration/proposed/tags regressions forbidden. Full committed test
suite (tests/verify-*.mjs) must stay green; new suite for logical mode.

## Reference implementation

`<scratchpad>/reference-old-viewer.html` (NEVER commit): `MODE` switching +
`buildModel()`, `nodeW/nodeH`, logical node construction in `buildNodes()`
(HEADER=24, ROWH=18, LOGW=210, `rowEls` index, zebra `stripe`, `kpk`/`kfk`
badges, `frow` highlight rects), `fieldAnchor()`, `setRowHi()`, per-mode
`lskey()`.

## Design decisions & flatbase-specific adaptations

- Column entries may be **plain strings** (FORMAT.md) — row name = the string,
  no badge. Guard every column access.
- `LOG_W` ≈ 220 (flatbase labels are longer than the reference's); label
  overflow: truncate with ellipsis (textLength squish acceptable too).
- Geometry: replace constant `NODE_W/NODE_H` reads in layout (overlap
  resolution, packComponents, parkIsolated, fit bbox, edgeGeometry anchors,
  centerViewportOnNode) with `nodeWidth(t)/nodeHeight(t)` helpers — conceptual
  returns the current constants, so conceptual mode's behavior (and its
  persisted layouts) is byte-identical after refactor.
- `edgeGeometry(edge)` grows mode awareness: logical mode returns row-anchored
  endpoints (sides L/R only); `applyEdgePaths` and `redrawIncidentEdges`
  unchanged consumers. Self-edges: keep the existing self-loop at header
  height, no row anchoring.
- Arb-ignored proposed columns: struck-through row text (mirror the sidebar
  treatment); the edge suppression logic is unchanged.
- The hub-at-origin invariant and layout determinism tests must pass in BOTH
  modes (run the layout suite once per mode).
- The `… +N` overflow row: pk/fk rows are prioritized into the visible 12 so
  most anchors stay real (sort: pk first, then fk columns in schema order,
  then the rest in schema order — display order note in the node makes this
  acceptable; document in FORMAT.md rendering notes).

## Packages (sequential, single file)

### P1 — mode toggle + logical nodes + layout adaptation
Toggle UI (both skeletons + CSS), `viewMode` state + persistence,
`nodeWidth/nodeHeight` helpers threaded through layout/fit/center, logical
node rendering (header band, capped rows, badges, zebra, proposed/inferred/
ignored styling, `rowEls`-style index for later row highlighting), per-mode
layout keys, mode-switch flow (re-render + applyLayout + fit). Edges may
temporarily anchor to node bounds (header-level) in logical mode — P2 fixes.
Commit: `feat(viewer): logical mode — table nodes with column rows, per-mode layout`

### P2 — field-anchored edges + row highlight + crow's-foot at rows
`edgeGeometry` logical branch (fieldAnchor port, pk-row resolution, overflow-
row fallback, L/R side pick), crow's-foot at row anchors, focus row
highlighting (edge focus → both rows; node focus → rows of incident edges),
drag redraw keeps row anchoring.
Commit: `feat(viewer): field-anchored edges + FK/PK row highlight in logical mode`

### P3 — docs + tests
CLAUDE.md (modes section, state, keys), FORMAT.md (logical rendering notes:
row cap/ordering, anchoring rules), `tests/verify-logical.mjs` (toggle,
logical node shape/rows/badges/cap, string columns, per-mode layout isolation
+ determinism, field-anchored edge endpoints move with drag, row highlight
under focus, proposed fixture in logical mode, frozen round-trip with mode
toggle), re-run all suites.
Commit: `docs+test(viewer): logical mode — docs reconciliation + E2E suite`
