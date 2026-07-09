# tests/ — E2E smoke suites (dev-only)

Playwright end-to-end checks that drive `db-viewer.html` in headless Chromium and
assert on the live DOM. They cover the graph-interaction feature set (FR layout,
pan/zoom, drag, focus, crow's-foot) plus the older sidebar/tags behaviour.

**These tests are dev tooling — they do NOT make flatbase depend on anything.**
The viewer itself stays a single dependency-free HTML file + a JSON sidecar. The
zero-dependency rule is a *runtime* contract on what ships; Playwright lives only
on the developer's machine and is never referenced by the viewer, the exports, or
the repo's package manifest (there isn't one).

## Requirements

- Node 18+ (ESM, top-level `await`).
- A globally installed Playwright with its browser downloaded:
  ```sh
  npm i -g playwright && npx playwright install chromium
  ```

Because these scripts are ESM, `NODE_PATH` does **not** help resolve a global
`playwright` (ESM ignores `NODE_PATH`). Each script therefore imports Playwright
dynamically from `PLAYWRIGHT_PATH` when set, falling back to a bare
`'playwright'` specifier (which works when the package resolves normally, e.g. a
local `node_modules` or an npm-linked global):

```js
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
```

Set `PLAYWRIGHT_PATH` to the absolute path of the global install's ESM entry
when the bare specifier can't resolve — for example under nvm:

```sh
export PLAYWRIGHT_PATH="$(npm root -g)/playwright/index.mjs"
```

## Running

`REPO` resolves from each script's own location (`tests/` → repo root), so the
suites run from anywhere. Point `OUTDIR` at a scratch dir for any screenshots /
frozen-export artifacts a suite writes:

```sh
OUTDIR=/tmp/out node tests/verify-interaction.mjs
```

Run the whole suite:

```sh
for f in tests/verify-*.mjs; do echo "== $f =="; OUTDIR=/tmp/out node "$f"; done
```

Each script prints `PASS`/`FAIL` lines and exits non-zero on any failure.

## Suites

| File                    | Covers                                                                 |
|-------------------------|------------------------------------------------------------------------|
| `verify-interaction.mjs`| FR layout determinism + persistence, `↻ Data` clears layout, wheel/ctrl-wheel/right-drag pan-zoom, Fit, sidebar pan-to-node (no container scroll). |
| `verify-drag-focus.mjs` | Node drag (transform-only + persisted), focus mode (dim/hi, edge focus, background/Esc clear), proposed styling under focus, dim-vs-arb-ignored stacking, Reset clears focus. |
| `verify-crowsfoot.mjs`  | Crow's-foot marks: fork=many / tick=one on `has_many`/`has_one`/`many_to_many`; `extends`/`polymorphic` keep dashed arrows; marks track drag; violet undashed proposed marks; frozen export carries marks. |
| `verify-sidebar.mjs`    | Sidebar search + counts, live domain recolor, persistence, frozen export, proposed-fixture regression. |
| `verify-tags.mjs`       | Free-form table tags (replace planned/modeled), chips, search, detail panel, frozen export, ellipsis. |

Fixtures used: `tables.json.example` (bookstore) and `docs/proposed-fixture.json`.
No on-disk `tables.json` is required — suites seed `localStorage` directly.
