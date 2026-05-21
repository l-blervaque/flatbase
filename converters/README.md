# flatbase converters

Standalone Python scripts (stdlib only, no pip required) that convert existing
database schemas to flatbase JSON.

## Quick reference

| Script | Source format | Extension | Example |
|---|---|---|---|
| `sql_ddl.py` | SQL DDL (PostgreSQL / MySQL / SQLite) | `.sql` | `python3 converters/sql_ddl.py schema.sql` |
| `prisma.py` | Prisma schema | `.prisma` | `python3 converters/prisma.py schema.prisma` |
| `rails_schema.py` | Rails `schema.rb` | `.rb` | `python3 converters/rails_schema.py schema.rb` |
| `dbml.py` | DBML (dbdiagram.io) | `.dbml` | `python3 converters/dbml.py schema.dbml` |
| `django_models.py` | Django `models.py` | `.py` | `python3 converters/django_models.py models.py` |

## Usage

```sh
# Single file → domain inferred from filename stem
python3 converters/sql_ddl.py schema.sql > tables.json

# Multiple files → one domain per file, merged output
python3 converters/sql_ddl.py commercial.sql sales.sql customer.sql > tables.json

# Write to file instead of stdout
python3 converters/sql_ddl.py schema.sql -o tables.json

# Stdin (domain = "main")
cat schema.sql | python3 converters/sql_ddl.py -
```

Same pattern for all converters.

## Output conventions

Every converter produces flatbase JSON with the following fields inferred automatically:

| Field | Source |
|---|---|
| `id` | table name, snake_case |
| `name` | table name, Title Case |
| `domain` | filename stem (or `TableGroup` for DBML) |
| `type` | inferred: `pivot` (composite PK of 2 FKs), `extension` (PK = FK), `entity` (default) |
| `columns[].pk` | `PRIMARY KEY` / `@id` / `[pk]` |
| `columns[].nullable` | absence of `NOT NULL` → `true` |
| `columns[].unique` | `UNIQUE` constraint |
| `columns[].fk` | `REFERENCES` / `ForeignKey` / `[ref:]` |
| `enums` | `CREATE TYPE AS ENUM` / Prisma `enum` / DBML `Enum` |

**Fields to set manually after conversion:**
- `type: "reference"` or `"cross-cutting"` — not structurally detectable
- `name_ja` — human translation
- `notes`, `description` — documentation

## Adding dependencies

If a converter ever needs a pip package, move it to a subfolder with its own README:

```
converters/
  sql_ddl/
    sql_ddl.py
    README.md   ← prerequisites + pip install instructions
```

## Known limits

### sql_ddl.py
- Complex `DEFAULT` expressions → passed as raw string
- `CHECK` constraints and generated columns → ignored (warning on stderr)
- Tested against PostgreSQL / MySQL / SQLite; MSSQL not guaranteed
- Multi-column `FOREIGN KEY` constraints → skipped (warning on stderr)

### prisma.py
- Implicit relations without `@relation` → not detected
- `@@map` renamed tables → physical name used
- `@@index` → ignored

### rails_schema.py
- `id: false` tables → no auto `id` column
- `add_foreign_key` without explicit `column:` infers column from table name (strips trailing `s`)

### dbml.py
- Only format with native domain support via `TableGroup`
- Quoted table/column names not supported

### django_models.py
- `ManyToManyField` → skipped (warning on stderr)
- Abstract models → skipped (warning on stderr)
- Self-referential FKs (`'self'`) → skipped (warning on stderr)
- Multi-class inheritance (concrete subclass of abstract mixin) → table silently skipped
