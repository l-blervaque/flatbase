// E2E smoke: FR layout determinism/persistence + viewport pan/zoom/fit + sidebar center.
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.OUTDIR || REPO;
const data = fs.readFileSync(path.join(REPO, 'tables.json.example'), 'utf8');
const URL = 'file://' + path.join(REPO, 'db-viewer.html');

const results = [];
const ok = (name, cond, detail = '') => {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) process.exitCode = 1;
};

// Read node positions from group transforms → { id: {x,y} }.
const readPositions = (page) => page.evaluate(() => {
  const out = {};
  document.querySelectorAll('#node-layer .node').forEach(g => {
    const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute('transform') || '');
    if (m) out[g.dataset.id] = { x: +m[1], y: +m[2] };
  });
  return out;
});
const vpTransform = (page) => page.evaluate(() => document.getElementById('viewport').getAttribute('transform'));

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

await page.goto(URL);
await page.evaluate(f => localStorage.setItem('flatbase.tables.json', f), data);
await page.reload();
await page.waitForSelector('.node', { timeout: 5000 });

// --- 1. Determinism: two FRESH computes (layout key removed between) → identical.
const P1 = await readPositions(page);
const layoutKey = await page.evaluate(() => layoutKey());
ok('layout key persisted after first load', await page.evaluate(k => !!localStorage.getItem(k), layoutKey), layoutKey);
await page.evaluate(k => localStorage.removeItem(k), layoutKey);
await page.reload();
await page.waitForSelector('.node', { timeout: 5000 });
const P2 = await readPositions(page);
const idsMatch = Object.keys(P1).length === Object.keys(P2).length && Object.keys(P1).length > 0;
const same = idsMatch && Object.keys(P1).every(id => P2[id] && Math.abs(P1[id].x - P2[id].x) < 1e-6 && Math.abs(P1[id].y - P2[id].y) < 1e-6);
ok('layout deterministic across two fresh computes', same, `n=${Object.keys(P1).length}`);

// --- 2. Hub-and-spoke sanity: highest-degree node's neighbors closer than the diameter.
const hub = await page.evaluate(() => {
  const deg = {}, nb = {};
  document.querySelectorAll('#edge-layer .edge').forEach(e => {
    const { from, to } = e.dataset;
    if (from === to) return;
    deg[from] = (deg[from] || 0) + 1; deg[to] = (deg[to] || 0) + 1;
    (nb[from] = nb[from] || new Set()).add(to);
    (nb[to] = nb[to] || new Set()).add(from);
  });
  let best = null;
  for (const id in deg) if (!best || deg[id] > deg[best]) best = id;
  return { best, neighbors: best ? [...(nb[best] || [])] : [] };
});
{
  const pos = P2;
  const c = (id) => ({ x: pos[id].x + 95, y: pos[id].y + 36 });
  let diameter = 0;
  const ids = Object.keys(pos);
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = c(ids[i]), b = c(ids[j]);
    diameter = Math.max(diameter, Math.hypot(a.x - b.x, a.y - b.y));
  }
  const hc = c(hub.best);
  const maxNb = Math.max(...hub.neighbors.map(n => { const p = c(n); return Math.hypot(p.x - hc.x, p.y - hc.y); }));
  ok('hub neighbors within graph diameter', hub.neighbors.length > 0 && maxNb < diameter, `hub=${hub.best} deg=${hub.neighbors.length} maxNb=${maxNb.toFixed(0)} diam=${diameter.toFixed(0)}`);
}

// --- 2b. Hub pinned at world origin AFTER post-passes (resolveOverlaps/packComponents
// can nudge it). Compute twice, then assert the max-degree connected node is at {0,0}.
const hubOrigin = await page.evaluate(() => {
  computePositions(); computePositions();
  const adj = {}; DATA.tables.forEach(t => (adj[t.id] = new Set()));
  for (const e of collectEdges()) {
    if (e.from === e.to || !adj[e.from] || !adj[e.to]) continue;
    adj[e.from].add(e.to); adj[e.to].add(e.from);
  }
  const conn = DATA.tables.map(t => t.id).filter(id => adj[id].size > 0);
  const center = conn.reduce((a, b) => (adj[b].size > adj[a].size ? b : a), conn[0]);
  const p = positions[center];
  return { center, x: p.x, y: p.y };
});
ok('hub sits exactly at world origin after layout', hubOrigin.x === 0 && hubOrigin.y === 0, JSON.stringify(hubOrigin));

// --- 3. Saved layout honored on reload (persistence path).
const shifted = Object.fromEntries(Object.entries(P2).map(([id, p]) => [id, { x: p.x + 1000, y: p.y + 500 }]));
await page.evaluate(({ k, s }) => localStorage.setItem(k, JSON.stringify(s)), { k: layoutKey, s: shifted });
await page.reload();
await page.waitForSelector('.node', { timeout: 5000 });
const P3 = await readPositions(page);
const honored = Object.keys(shifted).every(id => P3[id] && Math.abs(P3[id].x - shifted[id].x) < 1e-6 && Math.abs(P3[id].y - shifted[id].y) < 1e-6);
ok('saved layout applied on reload', honored);

// --- 4. ↻ Data clears the layout key (clearCachedData removes it before its location.reload).
const hadKey = await page.evaluate(k => !!localStorage.getItem(k), layoutKey);
await page.click('#reload-data-btn');
const gone = await page.evaluate(k => !localStorage.getItem(k), layoutKey);
ok('↻ Data removes the layout key', hadKey && gone, `hadKey=${hadKey} gone=${gone}`);

// Fresh page for viewport tests (clean state).
await page.goto(URL);
await page.evaluate(f => localStorage.setItem('flatbase.tables.json', f), data);
await page.reload();
await page.waitForSelector('.node', { timeout: 5000 });

// --- 5. Wheel = pan; ctrl+wheel = zoom (transform changes).
const t0 = await vpTransform(page);
await page.evaluate(() => {
  document.getElementById('diagram').dispatchEvent(new WheelEvent('wheel', { deltaX: 60, deltaY: 120, cancelable: true, bubbles: true }));
});
const tPan = await vpTransform(page);
ok('wheel pans the viewport', tPan !== t0, `${t0} -> ${tPan}`);
await page.evaluate(() => {
  const s = document.getElementById('diagram').getBoundingClientRect();
  document.getElementById('diagram').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, clientX: s.left + 200, clientY: s.top + 150, cancelable: true, bubbles: true }));
});
const tZoom = await vpTransform(page);
const zoomChanged = /scale\(([-\d.]+)\)/.exec(tZoom);
ok('ctrl+wheel zooms the viewport', tZoom !== tPan && zoomChanged && Math.abs(+zoomChanged[1] - 1) > 1e-6, tZoom);

// --- 6. Fit normalizes the transform (finite + idempotent).
await page.click('#fit-btn');
const tFit1 = await vpTransform(page);
await page.click('#fit-btn');
const tFit2 = await vpTransform(page);
const finite = /translate\(([-\d.]+),([-\d.]+)\) scale\(([-\d.]+)\)/.exec(tFit1);
ok('Fit produces a finite framed transform', !!finite && finite.slice(1).every(v => isFinite(+v)), tFit1);
ok('Fit is idempotent', tFit1 === tFit2, `${tFit1} == ${tFit2}`);

// --- 7. Sidebar click centers via viewport transform (NOT container scroll).
const before = await vpTransform(page);
const scrollBefore = await page.evaluate(() => { const w = document.getElementById('diagram-wrap'); return { l: w.scrollLeft, t: w.scrollTop }; });
await page.click('#sidebar-list .sidebar-table .row-body');
const after = await vpTransform(page);
const scrollAfter = await page.evaluate(() => { const w = document.getElementById('diagram-wrap'); return { l: w.scrollLeft, t: w.scrollTop }; });
ok('sidebar click changes viewport transform', after !== before, `${before} -> ${after}`);
ok('sidebar click does NOT scroll the container', scrollBefore.l === scrollAfter.l && scrollBefore.t === scrollAfter.t && scrollAfter.l === 0 && scrollAfter.t === 0, JSON.stringify(scrollAfter));

// --- 8. Hand tool: right-button drag pans; the following node click still opens the panel.
await page.click('#detail-close').catch(() => {});
await page.click('#fit-btn');
const tHandBefore = await vpTransform(page);
const box = await page.evaluate(() => { const s = document.getElementById('diagram').getBoundingClientRect(); return { x: s.left + s.width / 2, y: s.top + s.height / 2 }; });
await page.mouse.move(box.x, box.y);
await page.mouse.down({ button: 'right' });
await page.mouse.move(box.x + 80, box.y + 40, { steps: 4 });
await page.mouse.up({ button: 'right' });
const tHandAfter = await vpTransform(page);
ok('right-drag pans the viewport', tHandAfter !== tHandBefore, `${tHandBefore} -> ${tHandAfter}`);
// A left-click on a node right after the pan must still open the detail panel
// (regression guard for the stale-panMoved bug).
await page.click('#node-layer .node');
const panelOpen = await page.evaluate(() => !document.getElementById('detail-panel').classList.contains('closed'));
ok('node click after right-drag opens the panel', panelOpen, `panelOpen=${panelOpen}`);

await page.screenshot({ path: path.join(OUT, 'interaction-final.png') });

await browser.close();
console.log(results.join('\n'));
console.log(process.exitCode ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED');
