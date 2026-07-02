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
  otherwise. The "planned" label is shown on the node when not complete.
- **Badge** — `type` is displayed inside the node and in the sidebar.
- **Color** — comes from the table's `domain` (looked up in `domains[]`).

### `status` vs `modeled`

`status` is the preferred field. `modeled` stays as a backward-compat alias:

| `status`     | `modeled` | Border  | Badge       |
|--------------|-----------|---------|-------------|
| `complete`   | `true`    | solid   | type only   |
| `partial`    | —         | dashed  | + `planned` |
| `skeleton`   | `false`   | dashed  | + `planned` |

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

- `belongs_to` — never drawn (the parent's `has_many` covers it).
- `has_many` / `has_one` — solid arrow, child gets the arrowhead.
- `many_to_many` — solid line, arrowheads on both ends.
- `extends` — dashed arrow (parent → extension table).
- `polymorphic` — dotted arrow to each non-`"*"` target.

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
