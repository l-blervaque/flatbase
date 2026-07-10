# Request — render DEFINED enums + column/enum `status` (from lattice gen-schema)

> Change request from the lattice project (2026-07-02). The lattice's `gen-schema.py` now
> projects explicit `## Fields` / `## Enums` atoms into `tables.json` (field-layer
> amendment, lattice MODEL.md 2026-07-01). The viewer renders the *proposed* flavor of
> these elements (1b-0, validated) but not the *defined* flavor — which is what a lattice
> emits once the operator has ACCEPTED a proposal (`apply-proposal.py` → atoms
> `status=current` → gen-schema projects them WITHOUT the `proposed` flag).

## What gen-schema emits today (and the viewer ignores or hides)

1. **Defined (non-proposed) enums** — top-level `enums[]` entries with NO `proposed`
   flag, referenced by columns via `enum_ref`:

   ```json
   "enums": [
     {"id": "estimate_status",
      "values": [{"code": "billed", "label": "請求済み"}, {"code": "paid", "label": "入金確認済み"}],
      "status": "confirmed"}
   ]
   ```

   Current viewer behavior (checked against db-viewer.html at HEAD):
   - the `enum_ref` column badge renders ONLY when the referenced enum is `proposed`
     (`if (refEnum && refEnum.proposed) …`, ~l.1315) — a defined enum gets no badge;
   - the detail panel section is "Proposed enums" and filters `e.proposed && …`
     (~l.1215, l.1343) — a defined enum appears NOWHERE in the UI.

2. **Column `status`: `"confirmed"` | `"inferred"`** — on every column:
   - `confirmed` = an explicit, operator-accepted `## Fields` atom;
   - `inferred` = the id/FK **convention** (auto id PK on storage tables, `<parent>_id`
     from a stated belongs-to) — a fallback, weaker epistemic standing.
   The viewer currently ignores this field entirely; convention columns and confirmed
   columns render identically.

3. **Enum `status`** — same two values on `enums[]` entries, same meaning; ignored too.

## Requested changes (db-viewer.html)

1. **Defined-enum badge**: render the `enum→<id>` column flag for ANY resolvable
   `enum_ref`, styling proposed ones distinctly (keep the current violet/proposed
   treatment) and defined ones neutrally.
2. **Enums panel**: show ALL enums relevant to the table (owning `_home` OR referenced
   by a column) with their `code=label` values. Keep the ignore-arbitration buttons ONLY
   on proposed ones (defined enums are accepted data, not up for arbitration — the
   "Proposed enums" title can become "Enums" with a per-entry proposed marker).
3. **`status` rendering**: a visual distinction for `inferred` columns (e.g. dimmed /
   italic / an `inferred` chip) so the operator sees convention-derived structure vs
   operator-confirmed atoms at a glance. Same optional treatment for `inferred` enums.
4. *(nice-to-have)* An `enum_ref` resolving to NO entry in `enums[]` is a lattice gap
   (gen-schema keeps the ref and reports the gap): render it as `enum→<id> (undefined)`
   rather than silently unstyled.

## Contract notes

- `docs/FORMAT.md` already documents `enums[]` + `enum_ref` as first-class (§ "enums —
  optional; columns can reference them via enum_ref") — this request only asks the
  VIEWER to catch up with the format it already specs; no format change.
- `status` on columns/enums may need a one-line addition to FORMAT.md ("optional;
  `confirmed` | `inferred`; renderers MAY dim inferred elements").
- Backwards compatibility: schemas without `status` / without defined enums must render
  exactly as today.
- Test data: the lattice repo's `tools/tests/test_gen_schema.py` fixtures show every
  emitted shape; a real emitted file can be produced with
  `python3 <lattice-repo>/tools/gen-schema.py <lattice-dir> out.json out.md`.

## Why now

A production lattice project is about to run the accepted-schema round-trip (propose → prune →
apply → gen-schema): its output will contain defined enums and confirmed/inferred
columns, and today's viewer would silently hide the enums the operator just accepted.
