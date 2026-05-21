# Converters — Design Spec

**Date:** 2026-05-21
**Scope:** A set of standalone Python scripts that convert existing database schema formats into flatbase JSON.

---

## Goal

Allow users who already have a schema defined elsewhere (SQL DDL, Prisma, Rails, DBML, Django) to produce a `tables.json` compatible with the flatbase viewer without writing it by hand.

---

## Folder structure

```
converters/
  README.md             ← usage summary, output conventions, known limits
  sql_ddl.py            ← PostgreSQL / MySQL / SQLite DDL
  prisma.py             ← Prisma schema (.prisma)
  rails_schema.py       ← Rails schema.rb
  dbml.py               ← DBML (.dbml, dbdiagram.io)
  django_models.py      ← Django models.py
```

If a converter ever requires pip dependencies, it migrates to a subfolder:

```
converters/
  sql_ddl/
    sql_ddl.py
    README.md           ← prerequisites + pip install instructions
```

No converter requires external dependencies today. All use Python stdlib only (`re`, `json`, `argparse`, `pathlib`, `datetime`).

---

## Script architecture

Every script is fully self-contained — no imports between converters, no shared module. Each script follows this internal layout:

```python
#!/usr/bin/env python3
"""
flatbase converter — <Format Name>

Usage:
  python3 <script>.py schema.ext
  python3 <script>.py a.ext b.ext c.ext
  python3 <script>.py schema.ext -o tables.json
  cat schema.ext | python3 <script>.py -
"""
import re, json, sys, argparse
from datetime import date
from pathlib import Path

# ── BOILERPLATE (logique commune à tous les convertisseurs) ─────────────
# domain inference, multi-file merge, JSON output, CLI

# ── PARSER (spécifique à ce format) ─────────────────────────────────────
```

The boilerplate section is explicitly delimited so that bug fixes can be located and propagated across scripts easily.

---

## CLI interface

Identical across all scripts:

```sh
# Single file → domain inferred from filename (stem, lowercased)
python3 converters/sql_ddl.py schema.sql

# Multiple files → one domain per file, merged into one JSON output
python3 converters/sql_ddl.py commercial.sql sales.sql customer.sql

# Write to file instead of stdout
python3 converters/sql_ddl.py schema.sql -o tables.json

# Stdin (domain = "main")
cat schema.sql | python3 converters/sql_ddl.py -
```

- JSON output goes to **stdout**; warnings go to **stderr** — they never mix.
- `-o <file>` writes JSON to a file instead.
- Exit code `0` on success, `1` on fatal error.

---

## Input validation

Each script validates file extensions before parsing:

| Script | Accepted extensions |
|---|---|
| `sql_ddl.py` | `.sql` |
| `prisma.py` | `.prisma` |
| `rails_schema.py` | `.rb` |
| `dbml.py` | `.dbml` |
| `django_models.py` | `.py` |

Wrong extension → error on stderr + exit 1.

Stdin (`-`) → extension check skipped, warning printed: `reading from stdin, skipping extension check`.

`django_models.py` additional check: if the file content does not contain `models.Model`, a warning is printed on stderr but parsing continues.

---

## Domain inference

Domain is inferred from the input filename stem:

- `commercial.sql` → `"domain": "commercial"`
- `my_schema.sql` → `"domain": "my_schema"`
- Stdin → `"domain": "main"`

**Exception — DBML:** `TableGroup` blocks map directly to flatbase domains. When present, they take precedence over the filename.

---

## Output conventions

### What converters infer from the schema

| Field | Source |
|---|---|
| `id` | table name, snake_case |
| `name` | table name, Title Case |
| `domain` | filename stem (or `TableGroup` for DBML) |
| `type` | inferred from structure (see below) |
| `columns[].name` | column name |
| `columns[].type` | SQL/ORM type, passed through as-is |
| `columns[].pk` | `PRIMARY KEY` constraint |
| `columns[].nullable` | absence of `NOT NULL` → `true` |
| `columns[].unique` | `UNIQUE` constraint |
| `columns[].default` | `DEFAULT` value |
| `columns[].fk` | `REFERENCES` / `ForeignKey` → `"table_id"` or `{table, column, on_delete}` |
| `enums` | `CREATE TYPE AS ENUM` / Prisma `enum` / DBML `Enum` |

### Table type inference

| `type` | Condition |
|---|---|
| `"pivot"` | Composite PK made of exactly 2 FK columns (+ optional audit columns: `id`, `created_at`, `updated_at`, `created_by`, `updated_by`) |
| `"extension"` | Single PK column that is also a FK to another table |
| `"entity"` | Everything else (default) |

`"reference"` and `"cross-cutting"` are semantic concepts not derivable from structure — they default to `"entity"`. The README instructs users to adjust manually.

### Fields that are never generated

- `name_ja` — human translation
- `notes`, `description` — human documentation
- `status` — not set; flatbase renders without it

### Relations

Converters do **not** generate a `relations` block. They populate `fk` on columns and let flatbase derive relations automatically. This is the recommended approach per `docs/FORMAT.md`.

### Meta block

```json
{
  "meta": {
    "source": "sql_ddl",
    "converted_at": "2026-05-21"
  }
}
```

---

## Per-converter scope

### `sql_ddl.py` — PostgreSQL / MySQL / SQLite DDL

**Parsed:**
- `CREATE TABLE name (…)` — columns, types, constraints
- `NOT NULL`, `DEFAULT value`, `UNIQUE`, `PRIMARY KEY`
- Inline FK: `col INT REFERENCES other(id) ON DELETE CASCADE`
- Table-level FK: `FOREIGN KEY (col) REFERENCES other(id) ON DELETE …`
- Composite PK: `PRIMARY KEY (a, b)`
- `CREATE TYPE name AS ENUM (…)` → flatbase enums
- Table type inferred: `pivot`, `extension`, `entity`

**Ignored:** `CREATE INDEX`, `CREATE VIEW`, triggers, sequences, stored procedures, `IF NOT EXISTS`, schema prefixes (`public.table` → `table`), `--` and `/* */` comments stripped before parsing.

**Known limits:**
- Complex `DEFAULT` expressions (nested functions) → passed as raw string
- `CHECK` constraints → ignored, warning on stderr
- Generated columns (`GENERATED ALWAYS AS`) → ignored, warning on stderr
- Dialects: tested against PostgreSQL / MySQL / SQLite; MSSQL not guaranteed

---

### `prisma.py` — Prisma schema

**Parsed:**
- `model Name { … }` → tables
- `@id`, `@@id([a, b])` → simple or composite PK
- `@unique`, `@@unique` → `unique: true`
- `@default(…)` → `default`
- `?` suffix → `nullable: true`
- `@relation(fields: [x], references: [y])` → `fk: {table, column}`
- `enum Name { … }` → flatbase enums

**Ignored:** `datasource`, `generator`, `@@map`, `@@index`

**Known limits:**
- Implicit relations without explicit `@relation` → not detected
- `@@map` (renamed table) → physical name used, not the Prisma model name

---

### `rails_schema.rb` — Rails schema.rb

**Parsed:**
- `create_table "name"` + `t.type "col", null: false, default: …`
- `t.references "model"` → column `model_id` with `fk: "model"`
- `add_foreign_key "table", "other"` → FK on the corresponding column
- Implicit `id` PK generated unless `id: false`

**Ignored:** `add_index`, `enable_extension`, `force: :cascade`

**Known limits:**
- Tables with `id: false` → no `id` column generated
- Custom types (`t.custom_type`) → passed through as-is

---

### `dbml.py` — DBML (dbdiagram.io)

**Parsed:**
- `Table name { col type [pk, not null, unique, default: v, ref: > other.col] }`
- `Ref: a.col > b.col` → FK on the column
- `Enum name { … }` → flatbase enums
- `TableGroup name { tableA tableB }` → **flatbase domains** (only format with native domain support)

---

### `django_models.py` — Django models.py

**Parsed:**
- `class Name(models.Model):` → tables
- All standard fields: `CharField`, `IntegerField`, `UUIDField`, `DateTimeField`, `BooleanField`, `TextField`, `DecimalField`, etc.
- `null=True`, `unique=True`, `default=…`, `primary_key=True`
- `ForeignKey('Model', on_delete=…)` → `fk`
- `ManyToManyField('Model')` → `many_to_many` relation (via `fk` on a generated pivot table)
- `OneToOneField('Model')` → `fk` + `type: "extension"` inferred
- App prefix stripped: `'app.Model'` → `'model'`

**Ignored:** `class Meta`, methods, abstract models, `through=` on M2M

**Known limits:**
- `ManyToManyField` with `through=` → through table ignored (requires Python execution to resolve)
- Abstract models → ignored with warning on stderr

---

## `converters/README.md` content

The README contains:
1. Quick-reference table — one converter per row, source format, example command
2. Common usage — CLI, multi-file, stdin, `-o`
3. Output conventions — what is inferred automatically, what to adjust manually
4. Per-converter known limits (summary of the above)
