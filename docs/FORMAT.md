# flatbase schema format

The viewer accepts either:

- **Single bundled file** — one JSON file (e.g. `tables.json`) following the
  canonical shape described here.
- **Multi-file folder** — a directory drop containing
  `index.json`, one file per domain, and (optionally) `enums.json`. The loader
  bundles it into the canonical shape in memory.

Both produce the same internal structure. Use whichever is more convenient.

This document is the reference. Hand it to an LLM along with a sample to
generate new tables that the viewer can render.

---

## Canonical (bundled) shape

```jsonc
{
  "meta":    { "version": "...", "scope": "...", "status": "..." },
  "domains": [ { "id": "commercial", "color": "#4E79A7" }, ... ],
  "enums":   [ <enum>, ... ],          // optional
  "tables":  [ <table>, ... ]
}
```

- `meta` — free-form, displayed nowhere; useful for traceability.
- `domains` — **ordered**. Drives sidebar/legend order and node colors. If
  omitted, derived from the tables' `domain` field (insertion order, default
  palette).
- `enums` — optional; columns can reference them via `enum_ref`.
- `tables` — flat list, each table tagged with its `domain`.

---

## Table object

```jsonc
{
  "id":      "partner",
  "name":    "Partner",
  "name_ja": "パートナー",                // optional
  "domain":  "commercial",
  "type":    "entity",                  // entity | extension | pivot | reference | cross-cutting
  "status":  "complete",                // skeleton | partial | complete   (optional; preferred)
  "modeled": true,                      // legacy alias for status: true ↔ complete
  "tags":    ["mvp", "wave-2"],         // optional; free-form labels, rendered as chips
  "description": "...",                 // optional
  "notes":   "...",                     // optional; shown in detail panel
  "columns": [ <column>, ... ],         // optional but strongly recommended
  "indexes": [ <index>, ... ],          // optional
  "constraints":   [ <constraint>, ... ],
  "source_docs":   [ "docs/..." ],
  "open_questions":[ { "field": "...", "question": "...", "ref": "..." } ],
  "relations":     [ <relation>, ... ]  // optional; derived from columns when omitted
}
```

### Rendering

- **Border** — solid if `status === "complete"` (or `modeled: true`); dashed
  otherwise. `status` has no textual rendering (the former "planned"/"modeled"
  labels were removed — use `tags` for anything worth reading).
- **Badge** — `type` is displayed inside the node and in the sidebar.
- **Tags** — free-form `tags[]` render as `#tag` chips in the sidebar and the
  detail panel, and as a small gray `#tag` label on the node (truncated;
  suppressed on `proposed` nodes to avoid overlapping the proposed flag). The
  sidebar search also matches tags.
- **Color** — comes from the table's `domain` (looked up in `domains[]`).

### `status` vs `modeled`

`status` is the preferred field. `modeled` stays as a backward-compat alias:

| `status`     | `modeled` | Border  |
|--------------|-----------|---------|
| `complete`   | `true`    | solid   |
| `partial`    | —         | dashed  |
| `skeleton`   | `false`   | dashed  |

If both are present, `status` wins.

## `proposed` marker

An orthogonal boolean `proposed: true` may appear on any element (table, column,
relation, enum). It marks a **suggested, not-yet-defined** element (e.g. from an
automated schema proposer) awaiting human arbitration — distinct from `status`
(which describes how *modeled* a defined element is). Elements without the key are
treated as defined. The viewer renders proposed elements distinctly (a violet
"proposed" badge/flag, a dashed violet node border, and violet dashed edges) and
offers a header filter to show All / Proposed only / Defined only. Removing every
`proposed` key renders the schema exactly as if the marker never existed.

Notes on derived edges and the filter:

- A **proposed FK column** makes its derived edge render as proposed (violet,
  dashed). Ignoring that column in arbitration removes the edge from view and
  from the export.
- The header filter is **table-level**: a proposed FK edge between two *defined*
  tables stays visible under "Defined only" because both endpoints are visible.

### Proposal metadata passthrough

A proposal produced by an automated proposer (e.g. `lattice-propose-schema`) may
carry extra metadata on proposed elements. The viewer displays these and the
arbitrated export preserves them verbatim:

| Key           | On                | Meaning                                          |
|---------------|-------------------|--------------------------------------------------|
| `_evidence`   | any proposed elem | an atom-id (e.g. `M21-024`) or a prose snippet    |
| `_provenance` | any proposed elem | epistemic provenance, defaults to `design`        |
| `_home`       | proposed enums    | id of the entity/table that owns the enum         |

### Arbitration

When a loaded schema contains any `proposed` element, the viewer enters proposal
mode (a `↓ Proposal` button appears). The operator arbitrates:

- **per proposed column** — *ignore* (drop) or *overrule* (edit the type);
- **per proposed table** — *ignore* (drops the table, its columns, and its edges);
- **per proposed enum** — *ignore* (shown in the detail panel of the owning table,
  via `_home` or a referencing `enum_ref` column).

Decisions persist in `localStorage` under `flatbase.arbitration.<meta.project>`
and are cleared by `↻ Data`. Ignored elements stay rendered (dimmed / struck
through) so decisions are revertible; only the export drops them. `↓ Proposal`
downloads `proposal.arbitrated.json`: kept + overruled elements (still carrying
`proposed: true` and the `_` metadata), ignored elements removed, proposed FK
columns whose target table was ignored removed as well — valid input for
`apply-proposal.py`. Baseline (non-proposed) elements are never modified.

---

## Column object

A column is either a plain string (just the name) or an object:

```jsonc
{
  "name":     "customer_id",
  "type":     "bigint",                 // free-form: "varchar(255)", "decimal(10,2)", "uuid", etc.
  "pk":       true,                     // primary key (or part of composite PK)
  "nullable": false,                    // default true if omitted
  "unique":   true,
  "default":  "now()",
  "fk":       "customer",               // shorthand: target table id
  // OR:
  "fk":       { "table": "customer", "column": "id", "on_delete": "cascade" },
  "enum_ref": "case_status_estimate",   // references enums[].id
  "polymorphic": { "targets": ["case", "customer", "partner"] },
                                        // "*" in targets means "any table"
  "status":   "confirmed",              // inferred | confirmed | todo
  "description": "...",
  "notes":    "..."
}
```

In the detail panel, `fk` becomes a clickable badge that navigates to the
referenced table. `enum_ref` becomes an `enum→<id>` badge for any resolvable
reference (violet when the enum is proposed); an `enum_ref` with no matching
`enums[]` entry renders as `enum→<id> (undefined)` — a schema gap, not hidden.

Column `status` is optional (`confirmed` | `inferred` | `todo`): renderers MAY
dim `inferred` columns (convention-derived, e.g. auto id/FK columns) to
distinguish them from operator-confirmed ones. Absent `status` renders as today.

---

## Relations

Top-level `relations` is **optional** and only useful when columns don't
capture enough. When omitted, the viewer derives them from columns:

| Source on column                                | Derived relation                                                       |
|-------------------------------------------------|------------------------------------------------------------------------|
| `fk: "<id>"` or `fk: {table: "<id>"}`           | `belongs_to` on this table → `<id>`; inverse `has_many` on parent     |
| `polymorphic: { targets: [...] }`               | `polymorphic` on this table → each target                              |
| Table `type: "extension"` + PK column with `fk` | `extends` on the **parent** → this table (no `has_many` injected)      |

When `relations` is present on a table, it is used as-is and nothing is
derived for that table.

### Relation object

```jsonc
{
  "type":    "has_many",                // belongs_to | has_one | has_many | many_to_many | extends | polymorphic
  "target":  "book",                    // single-target relations
  "targets": ["case", "customer"],      // polymorphic only
  "label":   "wrote"                    // optional; shown on the edge
}
```

### Edge rendering

Cardinality is drawn as **crow's-foot end marks** (fork = "many", tick = "one")
on the relational types, replacing the old arrowheads. `extends` and
`polymorphic` keep their directional arrow + dash/dot treatment.

- `belongs_to` — never drawn (the parent's `has_many` covers it).
- `has_many` — solid line; **tick** at the parent, **fork** at the child.
- `has_one` — solid line; **tick** at both ends.
- `many_to_many` — solid line; **fork** at both ends.
- `extends` — dashed arrow (parent → extension table); no crow's-foot.
- `polymorphic` — dotted arrow to each non-`"*"` target; no crow's-foot.

Proposed edges carry the same crow's-foot marks, rendered violet (undashed
marks). Hover still surfaces the textual cardinality badge; the crow's-feet are
the always-visible syntax.

### Logical mode rendering

The viewer has a **Conceptual | Logical** header toggle. Conceptual mode
renders the compact nodes described above; Logical mode renders each table as
an ER-style box driven by `columns`:

- **Node anatomy** — a domain-tinted header band (table `name` + small
  `name_ja`), then one row per column: a key badge (`PK` gold, `FK` blue) +
  the column name, with zebra striping. Plain-string columns render as a
  name-only row. Proposed columns render violet, `status: "inferred"` italic,
  arbitration-ignored ones struck through. A table without `columns` renders
  as a header-only box.
- **Row cap** — at most **12** column rows are shown; the rest collapse into a
  final `… +N more` summary row (the detail panel remains the full view).
  Displayed rows are reordered: **PK columns first, then FK columns (schema
  order), then the rest (schema order)** — so key columns survive the cap. An
  FK column only overflows the cap when more than 11 pk+fk columns precede it.
- **Field-anchored edges** — an edge anchors to a column row **only when it
  knows its carrying FK column**, i.e. when it was **derived** from
  `columns[].fk` / `columns[].polymorphic` (derivation stamps `via`/`viaTable`
  on the relation). That end anchors at the FK column's row (left or right box
  side by relative node position); the other end anchors at the target's first
  `pk` column row (header band when no PK is identifiable). A capped column
  anchors at the `… +N more` row. **Explicit `relations` entries anchor
  header-to-header**, even when matching FK columns exist as rows — to get
  field anchoring, omit `relations` and let the viewer derive them. (Note:
  `tables.json.example` uses explicit `relations` on several tables, so the
  sample only partially demonstrates field anchoring.) Self-relations keep a
  loop bulging out of the right side of the box, not row-anchored.
  Crow's-foot marks render at the row anchors.
- **Row highlight on focus** — focusing an edge lights the anchored FK/PK rows
  on both ends (amber row background + bold name); focusing a node lights the
  rows of every visible incident edge. The same resolver drives the anchor
  geometry and the highlight, so the lit rows are exactly the anchored rows.
  Header-anchored (explicit) edges light no rows.

The mode is a viewing preference persisted in `localStorage`
(`flatbase.viewmode`), and layout positions persist per mode — see the
project docs for the keys.

---

## Enums

```jsonc
{
  "id":     "partner_type",
  "status": "complete",                 // optional
  "values": [
    { "code": "hall", "label": "Hall", "label_ja": "会館", "extension": "partner_hall" }
  ]
}
```

`values[].extension` (optional) names a table that exists when this code is
chosen — useful for STI-style modelling.

The detail panel lists every enum relevant to a table (owning `_home` or
referenced by one of its columns) under an "Enums" section. Defined enums are
accepted data — no arbitration controls; only `proposed` ones get an ignore
button. Enum `status` follows the column convention (`inferred` MAY be dimmed).

---

## Multi-file layout

A folder drop is accepted with this structure:

```
schema/
  index.json
  enums.json           (optional)
  <domain>.json        (one per entry in index.json's domains[])
```

`index.json`:

```jsonc
{
  "meta": { ... },
  "domains": [
    { "id": "commercial", "file": "commercial.json", "tables": ["partner", ...], "color": "#4E79A7" }
  ],
  "enums_file": "enums.json",            // optional; defaults to "enums.json"
  "out_of_scope_v05": [ { "id": "order", "wave": 3 } ]   // ignored by the viewer
}
```

Each domain file:

```jsonc
{ "domain": "commercial", "tables": [ <table>, ... ] }
```

Tables inside a domain file inherit `domain` from the file if they don't set
it explicitly. `domains[].color` is optional; if missing, the viewer assigns
colors from a default palette in `index.json` order.

---

## Audit columns convention

flatbase assumes every entity carries `created_at`, `updated_at`, `created_by`,
`updated_by` without repeating them per table. The viewer doesn't enforce
this — list them explicitly in `columns` if you want them rendered.
