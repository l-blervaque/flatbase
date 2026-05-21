# flatbase

Single-file HTML database viewer — JSON source of truth, zero dependencies.

Drop a schema (one file or a folder), get a navigable diagram: sidebar table list, force-directed ER graph, click-through detail panel with columns, types, FK navigation, relation arrows. Then click **↓ Export** to bake the current schema into a self-contained `.html` you can drop anywhere — `file://`, GitHub Pages, attached to an email — with no setup on the other end.

## Why

Most schema viewers want a server, a build step, an account, or all three. flatbase is one HTML file. You open it. You drop your schema. You read your schema. If you want to share it, you export a frozen copy and send the `.html`.

## Features

- **No dependencies.** Vanilla JS + SVG. No npm, no bundler, no CDN.
- **No server.** Runs on `file://` via a drag-drop loader; cached in `localStorage` after first use.
- **Two input shapes.** A single bundled `tables.json`, or a multi-file folder (`index.json` + per-domain files + optional `enums.json`). Both normalize to the same internal shape.
- **Force-directed layout.** Nodes self-organize once on load.
- **Domain filters, cascade-hide, FK navigation.** Click an FK badge to jump to the referenced table. Hide a node and any node it orphans hides too.
- **Frozen HTML export.** One click → standalone `.html` with the schema inlined as JSON. Locked to that schema, openable anywhere.

## Usage

### Atelier mode

```sh
git clone https://github.com/l-blervaque/flatbase.git
cd flatbase
cp tables.json.example tables.json
open db-viewer.html        # or just double-click it
```

First load shows a drop zone. Drop your `tables.json` (or a `schema/` folder). The viewer caches it in `localStorage` — subsequent loads are instant. The header **↻ Data** button clears the cache and re-prompts.

### Export a frozen viewer

In the atelier, click **↓ Export**. A `flatbase-<slug>.html` downloads. That file:

- Contains your schema inlined as JSON.
- Has no drag-drop, no cache, no `↻ Data` button — it is locked to the schema you exported.
- Opens with a double-click. Works in `file://` and on any static host (GitHub Pages, Netlify, etc.).
- Commit it next to your source schema in git for a navigable per-commit snapshot.

## Schema format

See [`docs/FORMAT.md`](docs/FORMAT.md) for the full spec. It's also the doc to hand to an LLM when generating new tables.

Quick taste — a minimal pair of tables:

```jsonc
{
  "domains": [{ "id": "commercial", "color": "#4E79A7" }],
  "tables": [
    {
      "id": "book",
      "name": "Book",
      "domain": "commercial",
      "type": "entity",
      "status": "complete",
      "columns": [
        { "name": "id",           "type": "uuid",         "pk": true },
        { "name": "title",        "type": "varchar(255)", "nullable": false },
        { "name": "publisher_id", "type": "uuid",         "fk": "publisher" }
      ]
    },
    {
      "id": "publisher",
      "name": "Publisher",
      "domain": "commercial",
      "type": "entity",
      "status": "complete"
    }
  ]
}
```

Relations are derived from `columns[].fk` automatically. Override or extend with explicit `relations` if you need polymorphic, m2m, extends, etc.

## Repo layout

```
db-viewer.html           Viewer (the whole product, ~1600 lines)
tables.json.example      Sample bookstore schema exercising every relation type
docs/FORMAT.md           Canonical schema format reference
docs/superpowers/        Design specs and implementation plans
CLAUDE.md                Project guidance for Claude Code / agents
```

`tables.json` is gitignored. Sample data lives in `tables.json.example`.

## Status

Used in anger for the Active.
