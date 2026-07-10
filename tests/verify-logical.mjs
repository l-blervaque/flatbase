// E2E verification: logical mode — table nodes with column rows, per-mode layout.
// P1 scope (mode toggle, logical node rendering, per-mode persistence). P2 extends
// this suite with field-anchored edges + row highlighting.
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.OUTDIR;
const data = fs.readFileSync(path.join(REPO, 'tables.json.example'), 'utf8');

const results = [];
const ok = (name, cond, detail = '') => {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) process.exitCode = 1;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
await page.goto('file://' + path.join(REPO, 'db-viewer.html'));
await page.evaluate(f => { localStorage.clear(); localStorage.setItem('flatbase.tables.json', f); }, data);
await page.reload();
await page.waitForSelector('.node', { timeout: 5000 });

// 1. Toggle exists, defaults conceptual
const toggle0 = await page.evaluate(() => ({
  exists: !!document.getElementById('mode-toggle'),
  concOn: document.getElementById('mode-conceptual').classList.contains('on'),
  logOn: document.getElementById('mode-logical').classList.contains('on'),
  anyLogical: !!document.querySelector('.node.logical'),
}));
ok('toggle present, defaults to conceptual', toggle0.exists && toggle0.concOn && !toggle0.logOn && !toggle0.anyLogical, JSON.stringify(toggle0));

// 2. Switch to logical → nodes gain .logical, toggle state flips, mode persisted
await page.click('#mode-logical');
await page.waitForSelector('.node.logical', { timeout: 5000 });
const sw = await page.evaluate(() => ({
  logOn: document.getElementById('mode-logical').classList.contains('on'),
  concOn: document.getElementById('mode-conceptual').classList.contains('on'),
  persisted: localStorage.getItem('flatbase.viewmode'),
}));
ok('switch to logical: state + persistence', sw.logOn && !sw.concOn && sw.persisted === 'logical', JSON.stringify(sw));

// 3. Persist across reload
await page.reload();
await page.waitForSelector('.node.logical', { timeout: 5000 });
const afterReload = await page.evaluate(() => ({
  logOn: document.getElementById('mode-logical').classList.contains('on'),
  anyLogical: !!document.querySelector('.node.logical'),
}));
ok('logical mode persists across reload', afterReload.logOn && afterReload.anyLogical, JSON.stringify(afterReload));

// 4. Logical node renders header + rows with PK/FK badges (book: PK id, FK publisher_id/language_id)
const book = await page.evaluate(() => {
  const g = document.querySelector('.node.logical[data-id="book"]');
  const texts = [...g.querySelectorAll('text')].map(t => t.textContent);
  const badges = [...g.querySelectorAll('text.lg-badge')].map(t => t.textContent);
  return {
    name: g.querySelector('text.lg-name').textContent,
    rowCount: g.querySelectorAll('text.lg-col').length,
    hasPk: badges.includes('PK'),
    hasFk: badges.includes('FK'),
    hasId: texts.includes('id'),
    hasPublisherFk: texts.includes('publisher_id'),
  };
});
ok('logical node: header + rows + PK/FK badges', book.name === 'Book' && book.rowCount >= 8 && book.hasPk && book.hasFk && book.hasId && book.hasPublisherFk, JSON.stringify(book));

// 5. Row cap: a table with >12 columns shows a "… +N more" overflow row
const bigCols = Array.from({ length: 20 }, (_, i) => (i === 0 ? { name: 'id', pk: true } : { name: 'field_' + i }));
const bigData = JSON.stringify({
  meta: { project: 'bigcap' },
  tables: [{ id: 'big', name: 'Big', domain: 'd', type: 'entity', columns: bigCols }],
});
await page.evaluate(f => { localStorage.clear(); localStorage.setItem('flatbase.viewmode', 'logical'); localStorage.setItem('flatbase.tables.json', f); }, bigData);
await page.reload();
await page.waitForSelector('.node.logical', { timeout: 5000 });
const cap = await page.evaluate(() => {
  const g = document.querySelector('.node.logical[data-id="big"]');
  const overflow = [...g.querySelectorAll('text.lg-overflow')].map(t => t.textContent);
  return { rows: g.querySelectorAll('text.lg-col').length, overflow };
});
ok('row cap: 12 rows + overflow summary', cap.rows === 12 && cap.overflow.length === 1 && /\+8 more/.test(cap.overflow[0]), JSON.stringify(cap));

// 6. String columns render as plain rows (no badge, name = the string)
const strData = JSON.stringify({
  meta: { project: 'strcols' },
  tables: [{ id: 'plain', name: 'Plain', domain: 'd', type: 'entity', columns: ['alpha', 'beta', 'gamma'] }],
});
await page.evaluate(f => { localStorage.clear(); localStorage.setItem('flatbase.viewmode', 'logical'); localStorage.setItem('flatbase.tables.json', f); }, strData);
await page.reload();
await page.waitForSelector('.node.logical', { timeout: 5000 });
const strRows = await page.evaluate(() => {
  const g = document.querySelector('.node.logical[data-id="plain"]');
  return {
    cols: [...g.querySelectorAll('text.lg-col')].map(t => t.textContent),
    badges: g.querySelectorAll('text.lg-badge').length,
  };
});
ok('string-column table renders plain rows', strRows.cols.join(',') === 'alpha,beta,gamma' && strRows.badges === 0, JSON.stringify(strRows));

// 7. Per-mode layout isolation: move a node in logical, switch to conceptual and back,
//    logical position is kept and conceptual layout is a different (independent) map.
await page.evaluate(f => { localStorage.clear(); localStorage.setItem('flatbase.viewmode', 'logical'); localStorage.setItem('flatbase.tables.json', f); }, data);
await page.reload();
await page.waitForSelector('.node.logical', { timeout: 5000 });
const iso = await page.evaluate(() => {
  // move book far in logical mode + persist
  positions['book'].x += 777; positions['book'].y -= 333;
  const movedX = positions['book'].x, movedY = positions['book'].y;
  saveLayout();
  const logKey = layoutKey();
  switchViewMode('conceptual');
  const concX = positions['book'].x, concKey = layoutKey();
  switchViewMode('logical');
  const backX = positions['book'].x, backY = positions['book'].y;
  return { movedX, movedY, concX, backX, backY, logKey, concKey,
           keysDiffer: logKey !== concKey && /\.logical$/.test(logKey) && !/\.logical$/.test(concKey) };
});
ok('per-mode layout isolation', iso.backX === iso.movedX && iso.backY === iso.movedY && iso.concX !== iso.movedX && iso.keysDiffer, JSON.stringify(iso));

// 8. Layout determinism in logical mode (two computePositions runs → identical map)
const det = await page.evaluate(() => {
  computePositions(); const a = JSON.stringify(positions);
  computePositions(); const b = JSON.stringify(positions);
  return a === b;
});
ok('logical layout deterministic', det);

// 9. No text overflow: every lg-col text width stays inside the box
const overflowCheck = await page.evaluate(() => {
  const bad = [];
  document.querySelectorAll('.node.logical text.lg-col').forEach(el => {
    const len = el.getComputedTextLength ? el.getComputedTextLength() : 0;
    const x = parseFloat(el.getAttribute('x')) || 0;
    if (x + len > 220 + 0.5) bad.push(el.textContent + ':' + Math.round(x + len));
  });
  return bad;
});
ok('no logical label overflows the box', overflowCheck.length === 0, JSON.stringify(overflowCheck.slice(0, 5)));

// 9b. viewMode is a viewing preference: NOT cleared by Reset (still logical after).
await page.click('#reset-btn');
const afterReset = await page.evaluate(() => ({
  mode: localStorage.getItem('flatbase.viewmode'),
  stillLogical: !!document.querySelector('.node.logical'),
}));
ok('Reset keeps view mode', afterReset.mode === 'logical' && afterReset.stillLogical, JSON.stringify(afterReset));

// 9c. Hub-at-origin invariant holds in logical mode (max-degree node at ~{0,0}).
const hub = await page.evaluate(() => {
  computePositions();
  let best = null, bestDeg = -1;
  const deg = {};
  for (const t of DATA.tables) deg[t.id] = 0;
  for (const e of collectEdges()) { if (e.from === e.to) continue; if (deg[e.from] === undefined || deg[e.to] === undefined) continue; deg[e.from]++; deg[e.to]++; }
  for (const id in deg) if (deg[id] > bestDeg) { bestDeg = deg[id]; best = id; }
  return { p: positions[best], id: best };
});
ok('hub pinned at origin in logical mode', hub.p && Math.abs(hub.p.x) < 1e-6 && Math.abs(hub.p.y) < 1e-6, JSON.stringify(hub));

await page.screenshot({ path: path.join(OUT, 'logical.png') });

// 10. Frozen export carries a working toggle (logical mode baked in)
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-btn')]);
const frozenPath = path.join(OUT, 'frozen-logical.html');
await dl.saveAs(frozenPath);
const page2 = await ctx.newPage();
await page2.goto('file://' + frozenPath);
await page2.waitForSelector('.node', { timeout: 5000 });
const frozen = await page2.evaluate(() => {
  const hasToggle = !!document.getElementById('mode-logical');
  // frozen viewer starts in whatever the persisted preference is; force conceptual then back
  switchViewMode('conceptual');
  const conc = !document.querySelector('.node.logical') && document.getElementById('mode-conceptual').classList.contains('on');
  switchViewMode('logical');
  const log = !!document.querySelector('.node.logical') && document.getElementById('mode-logical').classList.contains('on');
  return { hasToggle, conc, log };
});
ok('frozen export: working toggle', frozen.hasToggle && frozen.conc && frozen.log, JSON.stringify(frozen));

await browser.close();
console.log(results.join('\n'));
