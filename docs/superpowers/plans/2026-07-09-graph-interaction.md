# Graph interaction — FR layout, pan/zoom, drag, focus, crow's-foot

> Plan (2026-07-09). Ports the interaction model of the reference viewer
> (`old-partner-model.html`, an internal one-off ER viewer whose hub-and-spoke
> layout and navigation the operator validated) into flatbase, without giving up
> anything flatbase already does (format spec, arbitration, tags, exports).
> Scope decision: interaction first — the logical mode (columns inside nodes)
> and data-driven facets are deliberately deferred to a phase 2.

## Scope

1. **FR layout** — hub-and-spoke "stars": Fruchterman-Reingold with a short
   ideal edge length, highest-degree node pinned at origin, temperature
   annealing, then overlap resolution + disconnected-component packing +
   isolated-node parking. Deterministic (seeded RNG).
2. **Position persistence** — layout saved to localStorage per project; manual
   arrangements survive reloads.
3. **Pan / zoom** — viewport `<g>` transform: wheel pans 2D, ctrl/⌘+wheel zooms
   at the cursor, Space or right-button drag = hand tool, Fit button.
4. **Node drag** — reposition nodes, persisted.
5. **Focus mode** — node click dims everything but the neighborhood instead of
   hiding; edge click focuses its endpoints; background click clears. Hiding
   stays available via the sidebar eye toggles.
6. **Crow's-foot cardinality** — fork = many, tick = one on `has_many` /
   `has_one` / `many_to_many` edges; `extends` / `polymorphic` keep their
   current dash/dot treatment.

This supersedes the "out of scope: zoom/pan, drag-to-reposition, persistence"
line of the 2026-05-12 design spec — revised by operator decision (2026-07-09)
after comparing with the reference viewer.

## Non-negotiable constraints (existing contracts)

- Single HTML file, zero dependencies, no build step.
- **No literal `</script>` byte sequence** anywhere in the inline script
  (CLAUDE.md hard rule).
- `buildFrozenHTML`'s body skeleton must stay in sync with the source `<body>`
  markup — any new header button / stage element goes in BOTH places.
- Proposal-arbitration rendering is untouched: violet proposed nodes/edges,
  `arb-ignored` dimming, `↓ Proposal` export, arbitration localStorage.
- Tags, sidebar search/counts, domain recolor, defined-enum rendering: no
  regressions.
- Layout must be **deterministic**: seeded RNG (mulberry32-style, seed reset
  before each layout), no `Math.random`/`Date.now` in the layout path.
- `↻ Data` clears cache + arbitration + **saved layout**. Reset restores
  computed layout and clears focus/zoom (Fit).

## Reference implementation

`<scratchpad>/reference-old-viewer.html` (NEVER commit — internal data). The
algorithms to port live in its `<script>`: `layout()` (FR + annealing + pinned
hub), `resolveOverlaps`, `packComponents`, `parkIsolated`, `applyVP`/`onWheel`/
`startDragNode`/`beginPan` (pan/zoom/drag), `focusNode`/`focusEdge`/`setDim`
(focus), `cardMark`/`lineEnd` (crow's-foot). Port the *logic*, adapt to
flatbase's node geometry, styles and state model.

## Current-code anchors (db-viewer.html @ a646d3a)

- `computePositions()` ~line 600-741: current force sim (REPULSION 40000,
  SPRING_LENGTH 240, CENTER_FORCE) + overlap fix + translate-to-PAD.
- `render()` / `renderNodes()` / `renderEdges()` / `collectEdges()`: full SVG
  rebuild on every state change; listeners attached per render.
- SVG container: fixed-size SVG inside a scrollable `#diagram` div; sidebar
  click scrolls the container to the node (`scrollTo`).
- State vars near line 475 (`hiddenNodes`, `cascadeHiddenNodes`,
  `hiddenDomains`, `proposedFilter`, `sidebarSearch`, `highlightedNode`) +
  `resetState()`.
- Hover-cardinality labels + inline detail pane (added on main after PR #1).

## Steps (sequential — single file, no parallel edits)

Grouping for execution: steps 1+2 are one work package (layout world-coords and
viewport are coupled — the audit shows step 1 alone would break `setSVGSize`),
steps 3+4 are one package (drag and focus share the node event model), then 5,
then 6. One commit per step number regardless.

### 1. FR layout + persistence + determinism
- Replace the sim inside `computePositions()` with the FR scheme: repulsion
  `K²/d`, attraction `d²/K`, `K` tuned to flatbase node size (start at
  `NODE_W`, adjust so leaf rings sit tight), pin the highest-degree connected
  node at origin (re-pin each iteration), temperature `×0.975` per iter,
  ~420 iters, seeded RNG.
- Post-passes ported: `resolveOverlaps` (tight gaps ~30/26, center-Y aware if
  heights vary), `packComponents` (shelf-tile disconnected components),
  `parkIsolated` (isolated nodes into interior pockets).
- Persistence: localStorage key `flatbase.layout.<meta.project>`; load if the
  saved map covers every current node id, else recompute. Save after layout.
  `clearCachedData()` removes it; Reset removes it and relayouts.
- Keep the `positions = {id: {x,y}}` contract so render code is untouched.

### 2. Viewport pan/zoom + Fit
- Wrap all rendered content in `<g id="viewport">`; `render()` targets it.
  SVG fills its container (no scrollbars); `#diagram` stops scrolling.
- `panX/panY/zoomK` state; wheel = 2D pan (deltaMode-aware), ctrl/⌘+wheel =
  zoom at cursor (clamp ~0.12–3), Space or right-drag = hand (contextmenu
  suppressed), `Fit` button (header, BOTH skeletons) + fit after load/render.
- Sidebar click: replace container `scrollTo` with pan-to-center-node at the
  current zoom.
- Reset → fit.

### 3. Node drag
- Pointerdown (left, not a pan gesture) starts drag; 4px threshold separates
  click from drag; during drag update the node `<g>` transform and redraw only
  that node's edges; on drop, full `render()` is acceptable + save layout.
- Requires edges addressable by endpoint — keep an index built in
  `renderEdges` (edge element ↔ from/to ids).

### 4. Focus mode (dim/highlight)
- Node click → focus: every non-neighbor node/edge gets a `.dim` class
  (opacity ~.15, pointer-events none), neighbors + incident edges get `.hi`.
  Background click or Esc clears. Focus is view-only state (not persisted,
  cleared by Reset).
- Edge click → focus its two endpoints + itself. Add a transparent wide hit
  path (stroke-width ~14) per edge; wire the existing hover-cardinality
  tooltip to it if not already.
- Sidebar row click = focus + pan-to-node (replaces highlight+scroll).
- Eye toggles / domain checkboxes keep the existing hide + cascade semantics.
- Interplay: `.dim` must compose with `arb-ignored` (0.35 opacity) and
  proposed styling without visual conflicts — dim wins when both apply.

### 5. Crow's-foot cardinality
- New end-marker painter (ported `cardMark`): fork (3-prong, apex on the
  line) = many; short tick = one. Applied per relation type:
  `has_many` parent→child: tick at parent, fork at child; `has_one`:
  tick/tick; `many_to_many`: fork/fork. `extends` and `polymorphic` keep
  their current arrowheads/dash. `belongs_to` still never drawn.
- Visible line stops at the fork apex (`lineEnd`) so the fork reads cleanly.
- Proposed edges: same marks, violet + dashed as today.
- Drop the SVG `<marker>` arrowheads on converted types only.

### 6. Docs, fixtures, E2E
- CLAUDE.md: Layout / State / Interactions sections rewritten (positions
  persisted, pan/zoom state, focus vs hide); out-of-scope line updated (this
  plan's carve-out).
- FORMAT.md: edge-rendering table gains the cardinality-marks column.
- Design-spec addendum note at the top of 2026-05-12 spec (superseded items).
- New Playwright suite `verify-interaction.mjs`: star layout (leaf ring around
  a hub), determinism (two loads → identical positions), persistence (drag →
  reload → position kept; ↻ Data clears), pan/zoom transforms, focus dim
  counts, crow's-foot path presence per relation type, sidebar pan-to-node.
  Re-run `verify-sidebar.mjs` + `verify-tags.mjs` (13 + 9 checks) + a frozen
  export round-trip with all new features live in the frozen copy.

## Audit findings (Codex gpt-5.5, pre-implementation — MUST be honored)

Full transcript: `<scratchpad>/codex-audit.txt`. Structural findings folded in:

**Layout / coordinates**
- `computePositions()` (598) is called once at init: wrap as
  `loadPositions() || computePositions()`; keep it pure + deterministic.
- `Math.random()` lives in the collision fallback (653) — the seeded PRNG must
  cover EVERY jitter path.
- Layout currently dedupes edges by sorted endpoints (626), dropping parallel
  relations: derive layout edges from `collectEdges()` or a shared normalizer.
- Layout translates to positive coords (728) and `setSVGSize()` (775) assumes
  them: with the viewport model, keep world coordinates centered at origin and
  let Fit do screen placement; `setSVGSize` disappears (SVG fills container).
- Init order bug: `computePositions()` (2223) runs before `loadArbitration()`
  (2241) — load arbitration right after DATA init, before layout/render.
- Layout localStorage key must embed a schema signature (sorted table ids),
  not just `meta.project`, to invalidate stale layouts.
- `clearCachedData()` (2210) must also remove the layout key.
- `resetState()` (1705) double-renders via `closePanel` — fix; Reset semantics:
  clears focus, restores computed layout (drops saved positions), Fit.

**Render pipeline / drag**
- Nodes are absolute-child-coordinates (810), not translated groups: migrate to
  `<g transform="translate(x,y)">` with local child coords BEFORE drag.
- `renderNodes`/`renderEdges` rebuild everything per render (783/1036): drag
  must never full-render per frame — transform-only + redraw incident edge
  paths via rAF; full render on drop is fine.
- Introduce `<g id="viewport"><g id="edge-layer"></g><g id="node-layer"></g></g>`
  (451 + frozen skeleton) to keep layering stable.
- Node click currently opens the detail panel (886): a drag emits a click on
  pointerup — suppress with a 4px movement threshold.
- `collectEdges()` dedupe key (1018) collapses same-type parallel edges and can
  hide a proposed edge behind a defined one (1026): include label/via/viaTable
  in the key or merge with proposed-state priority.
- `arbSuppressed` (1049) suppresses edges for any matching colArb key without
  checking the column is still proposed — align with export semantics.

**Pan/zoom / navigation**
- `#diagram-wrap` is overflow-scroll (174): make it non-scroll, wheel handler
  non-passive with `preventDefault()`.
- `openDetailPanel()` centers via `wrap.scrollTo()` (1505) → replace with
  `centerViewportOnNode(id)` (world→screen math). Arb-button refreshes call
  `openDetailPanel(id)` (1470) and FK navigation recurses (1493): recenter ONLY
  on intentional navigation (`{center:true}`), never on same-id refresh.
- `highlightNode()` (1720) is legacy scroll-centering — remove or rewire.
- Space hand-tool must not swallow spaces typed in the search input (446/2251);
  `contextmenu` prevention scoped to the diagram only (451).

**Focus / styling interplay**
- Split `focusedNode` (persistent click state) from transient `hoveredNode`
  (1737); CSS: `body.focusing` distinct from `body.hovering` (216) with clear
  precedence.
- `arb-ignored` (171) and proposed violet (1119) must stay recognizable under
  focus dim and pair-highlight orange (219/228): preserve dash/violet under
  focus; define opacity stacking (dim wins, ignored stays struck in sidebar).
- Keep the recent behavior: node hover does NOT reveal edge labels (209);
  hover-cardinality badges stay hover-only detail — crow's-feet are the
  always-visible syntax (973), labels are not removed.
- Edge CSS assumes direct path children (195): use named classes `.edge-line`,
  `.edge-hit`, `.edge-marker`; marker geometry `pointer-events: none`.

**Markers**
- SVG `<marker>` arrowheads are hard-coded gray (894) and can't inherit violet:
  draw crow's-feet as stroked end geometry (like the reference viewer), not
  `<marker>` defs, on converted types; keep FORMAT.md directionality (child
  carries the fork on `has_many`).
- New `endMarkersFor(edge)` separate from the existing `cardinalityFor()`
  badge text (933).

**Contracts**
- Never write positions into `RAW_INPUT` (1812) — separate localStorage key.
- Fit button + viewport groups added to BOTH body skeletons (429/2127) + CSS
  selectors (61).
- Export escaping of closing-script sequences (2121): any new inline JSON path
  reuses the central escape.
- Keep: sidebar search stays sidebar-only (2230); proposed filter stays
  table-level (FORMAT.md 101); eye-toggle cascade + detail-pane "Hide this
  table" both stay (1192/1473).
- CLAUDE.md lines 33/35/41/44/66 all describe superseded behavior — rewrite in
  step 6.

## Risks called out up-front

- **Render pipeline rebuilds DOM per state change** — focus/drag must not
  trigger full relayout; drag uses transform-only updates mid-gesture.
- **scrollTo → pan migration** touches sidebar navigation and the `↻ Data`
  overlay; check the picker overlay still centers.
- **Frozen skeleton drift** — the Fit button and any stage-bar markup must be
  mirrored in `buildFrozenHTML`.
- **Event model** — right-drag pan needs `contextmenu` suppression only over
  the SVG, not the whole app (sidebar context menus stay native).
- **Persisted layout vs schema change** — id-coverage check invalidates saved
  layouts when tables are added/removed (same rule as the reference viewer).
