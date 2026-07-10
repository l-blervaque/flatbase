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

// ---------------------------------------------------------------------------
// P2 — field-anchored edges + FK/PK row highlight + crow's-foot at row anchors
// ---------------------------------------------------------------------------
const nums = d => (d.match(/-?\d+\.?\d*/g) || []).map(Number);
const start = d => { const n = nums(d); return { x: n[0], y: n[1] }; };
const end = d => { const n = nums(d); return { x: n[n.length - 2], y: n[n.length - 1] }; };
const near = (a, b, tol = 1.0) => Math.abs(a - b) <= tol;

// Controlled 2-table fixture: parent(id pk, name) 1—N child(id pk, parent_id fk, note).
// logicalRows order = pk first, then fk: child.parent_id lands at ordered idx 1.
const anchorData = JSON.stringify({
  meta: { project: 'anchors' },
  tables: [
    { id: 'parent', name: 'Parent', domain: 'd', type: 'entity',
      columns: [{ name: 'id', pk: true }, { name: 'name' }] },
    { id: 'child', name: 'Child', domain: 'd', type: 'entity',
      columns: [{ name: 'id', pk: true }, { name: 'parent_id', fk: 'parent' }, { name: 'note' }] },
  ],
});
await page.evaluate(f => { localStorage.clear(); localStorage.setItem('flatbase.viewmode', 'logical'); localStorage.setItem('flatbase.tables.json', f); }, anchorData);
await page.reload();
await page.waitForSelector('.node.logical', { timeout: 5000 });

const K = await page.evaluate(() => ({ H: LOG_HEADER, RH: LOG_ROWH, W: LOG_W }));
const rowCY = idx => K.H + idx * K.RH + K.RH / 2;   // local center-Y of ordered row idx

// 11. FK end lands at the FK row Y; PK end lands at the PK row Y (assert on hit-path,
//     whose d is the untrimmed geometry — exact in both X and Y).
const fkEdge = await page.evaluate(() => {
  const g = [...document.querySelectorAll('#edge-layer .edge')].find(g => g.__edge && g.__edge.via === 'parent_id');
  const e = g.__edge;
  return { from: e.from, to: e.to, hitD: g.querySelector('path.hit-path').getAttribute('d'),
           pFrom: positions[e.from], pTo: positions[e.to] };
});
{
  // from = parent (anchors at parent pk 'id', ordered idx 0), to = child (parent_id, idx 1)
  const s = start(fkEdge.hitD), en = end(fkEdge.hitD);
  const expFromY = fkEdge.pFrom.y + rowCY(0);
  const expToY = fkEdge.pTo.y + rowCY(1);
  const sideFromRight = (fkEdge.pFrom.x + K.W / 2) <= (fkEdge.pTo.x + K.W / 2);
  const expFromX = sideFromRight ? fkEdge.pFrom.x + K.W : fkEdge.pFrom.x;
  const expToX = sideFromRight ? fkEdge.pTo.x : fkEdge.pTo.x + K.W;
  ok('logical FK end anchors at FK row Y', near(en.y, expToY) && near(en.x, expToX),
     `got ${JSON.stringify(en)} exp {x:${expToX.toFixed(1)},y:${expToY.toFixed(1)}}`);
  ok('logical PK end anchors at PK row Y', near(s.y, expFromY) && near(s.x, expFromX),
     `got ${JSON.stringify(s)} exp {x:${expFromX.toFixed(1)},y:${expFromY.toFixed(1)}}`);
}

// 12. Crow's-foot fork present at the child (many) row anchor; tick at parent (one) end.
const marks = await page.evaluate(() => {
  const g = [...document.querySelectorAll('#edge-layer .edge')].find(g => g.__edge && g.__edge.via === 'parent_id');
  return {
    to: (g.querySelector('.edge-marker[data-end="to"]') || {}).getAttribute ? g.querySelector('.edge-marker[data-end="to"]').getAttribute('d') : '',
    from: (g.querySelector('.edge-marker[data-end="from"]') || {}).getAttribute ? g.querySelector('.edge-marker[data-end="from"]').getAttribute('d') : '',
  };
});
{
  const forkAtToRow = (marks.to.match(/M/g) || []).length >= 3 && near(end(marks.to).y, fkEdge.pTo.y + rowCY(1), 12);
  ok('crow\'s-foot fork at FK row anchor', forkAtToRow, JSON.stringify(marks.to));
}

// 13. Drag the child node → the FK endpoint follows the row (redrawIncidentEdges path).
const dragged = await page.evaluate(() => {
  const cy0 = positions['child'].y;
  positions['child'].y = cy0 + 250;
  positions['child'].x = positions['child'].x + 40;
  redrawIncidentEdges('child');
  const g = [...document.querySelectorAll('#edge-layer .edge')].find(g => g.__edge && g.__edge.via === 'parent_id');
  return { hitD: g.querySelector('path.hit-path').getAttribute('d'), pTo: positions['child'] };
});
{
  const en = end(dragged.hitD);
  ok('drag: FK endpoint follows the row', near(en.y, dragged.pTo.y + rowCY(1)),
     `got ${en.y.toFixed(1)} exp ${(dragged.pTo.y + rowCY(1)).toFixed(1)}`);
}

// 14. Edge without via anchors header-to-header (explicit has_many, no FK column).
const noViaData = JSON.stringify({
  meta: { project: 'noVia' },
  tables: [
    { id: 'p', name: 'P', domain: 'd', type: 'entity', columns: [{ name: 'id', pk: true }, { name: 'a' }],
      relations: [{ type: 'has_many', target: 'q' }] },
    { id: 'q', name: 'Q', domain: 'd', type: 'entity', columns: [{ name: 'id', pk: true }, { name: 'b' }] },
  ],
});
await page.evaluate(f => { localStorage.clear(); localStorage.setItem('flatbase.viewmode', 'logical'); localStorage.setItem('flatbase.tables.json', f); }, noViaData);
await page.reload();
await page.waitForSelector('.node.logical', { timeout: 5000 });
const noVia = await page.evaluate(() => {
  const g = [...document.querySelectorAll('#edge-layer .edge')].find(g => g.__edge && g.__edge.from === 'p' && g.__edge.to === 'q');
  const e = g.__edge;
  return { hasVia: !!e.via, hitD: g.querySelector('path.hit-path').getAttribute('d'), pFrom: positions.p, pTo: positions.q, H: LOG_HEADER };
});
{
  const s = start(noVia.hitD), en = end(noVia.hitD);
  ok('edge without via anchors header-to-header',
     !noVia.hasVia && near(s.y, noVia.pFrom.y + noVia.H / 2) && near(en.y, noVia.pTo.y + noVia.H / 2),
     `from ${s.y.toFixed(1)}/${(noVia.pFrom.y + noVia.H / 2).toFixed(1)} to ${en.y.toFixed(1)}/${(noVia.pTo.y + noVia.H / 2).toFixed(1)}`);
}

// 15. Overflow-column FK anchors at the overflow row Y. 12 FKs to 12 DISTINCT parents
//     (distinct parents → distinct has_many edges; same-parent FKs would collapse to
//     one). Ordered rows = pk(id) + f1..f11 (12 rows) → f12 overflows.
const ovData = JSON.stringify({
  meta: { project: 'ovfk' },
  tables: [
    ...Array.from({ length: 12 }, (_, i) => ({ id: 'p' + (i + 1), name: 'P' + (i + 1), domain: 'd', type: 'entity', columns: [{ name: 'id', pk: true }] })),
    { id: 'ch', name: 'Ch', domain: 'd', type: 'entity',
      columns: [{ name: 'id', pk: true }, ...Array.from({ length: 12 }, (_, i) => ({ name: 'f' + (i + 1), fk: 'p' + (i + 1) }))] },
  ],
});
await page.evaluate(f => { localStorage.clear(); localStorage.setItem('flatbase.viewmode', 'logical'); localStorage.setItem('flatbase.tables.json', f); }, ovData);
await page.reload();
await page.waitForSelector('.node.logical', { timeout: 5000 });
const ov = await page.evaluate(() => {
  const g = [...document.querySelectorAll('#edge-layer .edge')].find(g => g.__edge && g.__edge.via === 'f12');
  if (!g) return null;
  const rows = logicalRows(DATA.tables.find(t => t.id === 'ch'));
  return { hitD: g.querySelector('path.hit-path').getAttribute('d'), pTo: positions.ch,
           rowsLen: rows.rows.length, overflow: rows.overflow, H: LOG_HEADER, RH: LOG_ROWH };
});
{
  const en = end(ov.hitD);
  const expY = ov.pTo.y + ov.H + ov.rowsLen * ov.RH + ov.RH / 2;   // overflow row local cy
  ok('overflow-column FK anchors at overflow row Y',
     ov.overflow > 0 && ov.rowsLen === 12 && near(en.y, expY),
     `got ${en.y.toFixed(1)} exp ${expY.toFixed(1)} (rows ${ov.rowsLen}, ovf ${ov.overflow})`);
}

// 16. Focus an edge → both anchored rows carry .row-hi (rect + bold name); clears on
//     background click.
await page.evaluate(f => { localStorage.clear(); localStorage.setItem('flatbase.viewmode', 'logical'); localStorage.setItem('flatbase.tables.json', f); }, anchorData);
await page.reload();
await page.waitForSelector('.node.logical', { timeout: 5000 });
const efocus = await page.evaluate(() => {
  const e = collectEdges().find(e => e.via === 'parent_id');
  focusEdge(e);
  const childRow = nodeRowEls['child'].byName['parent_id'];
  const parentRow = nodeRowEls['parent'].byName['id'];
  const on = {
    childRect: childRow.fr.classList.contains('row-hi'),
    childName: childRow.name.classList.contains('row-hi'),
    parentRect: parentRow.fr.classList.contains('row-hi'),
    parentName: parentRow.name.classList.contains('row-hi'),
    // a non-anchored row stays un-highlighted
    otherName: nodeRowEls['child'].byName['note'].name.classList.contains('row-hi'),
  };
  clearFocus();
  const cleared = !childRow.fr.classList.contains('row-hi') && !parentRow.name.classList.contains('row-hi');
  return { on, cleared };
});
ok('edge focus highlights both anchored rows',
   efocus.on.childRect && efocus.on.childName && efocus.on.parentRect && efocus.on.parentName && !efocus.on.otherName,
   JSON.stringify(efocus.on));
ok('background click clears row highlight', efocus.cleared);

// 17. Focus a node → rows of all incident edges highlighted on both ends.
const nfocus = await page.evaluate(() => {
  focusNode('parent');
  const r = {
    parentPk: nodeRowEls['parent'].byName['id'].name.classList.contains('row-hi'),
    childFk: nodeRowEls['child'].byName['parent_id'].name.classList.contains('row-hi'),
  };
  clearFocus();
  return r;
});
ok('node focus highlights incident rows on both ends', nfocus.parentPk && nfocus.childFk, JSON.stringify(nfocus));

// 18. Proposed fixture in logical mode: violet edge + violet marks at the violet column row.
const proposed = fs.readFileSync(path.join(REPO, 'docs/proposed-fixture.json'), 'utf8');
await page.evaluate(f => { localStorage.clear(); localStorage.setItem('flatbase.viewmode', 'logical'); localStorage.setItem('flatbase.tables.json', f); }, proposed);
await page.reload();
await page.waitForSelector('.node.logical', { timeout: 5000 });
const prop = await page.evaluate(() => {
  const g = [...document.querySelectorAll('#edge-layer .edge')].find(g => g.__edge && g.__edge.via === 'other_tbl_id');
  if (!g) return null;
  const e = g.__edge;
  const line = g.querySelector('path.edge-line');
  const mk = g.querySelector('.edge-marker');
  // the FK column row on existing_tbl is proposed → violet lg-col
  const rec = nodeRowEls['existing_tbl'].byName['other_tbl_id'];
  const colEl = rec && rec.name;
  return {
    proposed: !!e.proposed,
    lineStroke: line.getAttribute('stroke'),
    markStroke: mk ? mk.getAttribute('stroke') : null,
    colViolet: colEl ? colEl.classList.contains('proposed') : false,
    anchorD: g.querySelector('path.hit-path').getAttribute('d'),
    pTo: positions['existing_tbl'], rowCY: rec ? rec.cy : null,
  };
});
{
  const en = end(prop.anchorD);
  const violet = '#8b5cf6';
  ok('proposed edge in logical: violet line + marks',
     prop.proposed && prop.lineStroke === violet && prop.markStroke === violet && prop.colViolet,
     JSON.stringify({ line: prop.lineStroke, mark: prop.markStroke, colViolet: prop.colViolet }));
  ok('proposed edge anchors at its violet column row', near(en.y, prop.pTo.y + prop.rowCY),
     `got ${en.y.toFixed(1)} exp ${(prop.pTo.y + prop.rowCY).toFixed(1)}`);
}

// 19. Screenshot: logical mode with a focused edge — rows highlighted, marks clean.
await page.evaluate(f => { localStorage.clear(); localStorage.setItem('flatbase.viewmode', 'logical'); localStorage.setItem('flatbase.tables.json', f); }, data);
await page.reload();
await page.waitForSelector('.node.logical', { timeout: 5000 });
await page.evaluate(() => {
  const e = collectEdges().find(e => e.via && !e.proposed) || collectEdges().find(e => e.via);
  if (e) focusEdge(e);
});
await page.screenshot({ path: path.join(OUT, 'logical-focus-edge.png') });

// 20. Conceptual edgeGeometry untouched: row-hi is a no-op, layout still deterministic.
await page.evaluate(f => { localStorage.clear(); localStorage.setItem('flatbase.viewmode', 'conceptual'); localStorage.setItem('flatbase.tables.json', f); }, data);
await page.reload();
await page.waitForSelector('.node', { timeout: 5000 });
const concDet = await page.evaluate(() => {
  computePositions(); const a = JSON.stringify(positions);
  computePositions(); const b = JSON.stringify(positions);
  const g = document.querySelector('#edge-layer .edge');
  return { det: a === b, anyLogical: !!document.querySelector('.node.logical'), hasEdge: !!g };
});
ok('conceptual mode intact after P2 (deterministic, no logical nodes)',
   concDet.det && !concDet.anyLogical && concDet.hasEdge, JSON.stringify(concDet));

// 21. Duplicate column names: the row anchor (logicalRowCY, first-match) and the
//     row highlight (nodeRowEls byName, last-write-wins) must resolve to the SAME
//     row — logicalRows dedupes by name (first occurrence wins), so rowsLen drops
//     the second 'tag' and both accessors agree.
const dupData = JSON.stringify({
  meta: { project: 'dup' },
  tables: [{ id: 'd', name: 'D', domain: 'x', type: 'entity',
    columns: [{ name: 'id', pk: true }, { name: 'tag' }, { name: 'tag' }] }],
});
await page.evaluate(f => { localStorage.clear(); localStorage.setItem('flatbase.viewmode', 'logical'); localStorage.setItem('flatbase.tables.json', f); }, dupData);
await page.reload();
await page.waitForSelector('.node.logical', { timeout: 5000 });
const dup = await page.evaluate(() => {
  const t = DATA.tables.find(t => t.id === 'd');
  return { anchorCY: logicalRowCY(t, 'tag'), hiCY: nodeRowEls['d'].byName['tag'].cy,
           rowsLen: logicalRows(t).rows.length };
});
ok('duplicate column names: anchor row Y === highlighted row Y',
   dup.anchorCY === dup.hiCY && dup.rowsLen === 2, JSON.stringify(dup));

await browser.close();
console.log(results.join('\n'));
