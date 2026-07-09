// E2E: node drag (transform-only + persist) + focus mode (dim/hi, edge focus,
// background/Esc clear, proposed styling under focus, Reset clears focus).
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.OUTDIR || REPO;
const data = fs.readFileSync(path.join(REPO, 'tables.json.example'), 'utf8');
const fixture = fs.readFileSync(path.join(REPO, 'docs/proposed-fixture.json'), 'utf8');
const URL = 'file://' + path.join(REPO, 'db-viewer.html');

const results = [];
const ok = (name, cond, detail = '') => {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) process.exitCode = 1;
};

const seed = async (page, json) => {
  await page.goto(URL);
  await page.evaluate(f => localStorage.setItem('flatbase.tables.json', f), json);
  await page.reload();
  await page.waitForSelector('.node', { timeout: 5000 });
};

// Screen-space center of a node's rect.
const nodeCenter = (page, id) => page.evaluate((id) => {
  const g = document.querySelector(`#node-layer .node[data-id="${CSS.escape(id)}"]`);
  const r = g.querySelector('rect').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, id };
}, id);

// Dispatch a click on a node element (bubbles to the group handler). Used for
// state-machine re-focus steps where the detail panel overlays the node's
// screen coords — real-mouse hit-testing is already validated elsewhere.
const clickNodeEl = (page, id) => page.evaluate((id) => {
  const g = document.querySelector(`#node-layer .node[data-id="${CSS.escape(id)}"]`);
  g.querySelector('rect').dispatchEvent(new MouseEvent('click', { bubbles: true }));
}, id);

const transformOf = (page, id) => page.evaluate((id) =>
  document.querySelector(`#node-layer .node[data-id="${CSS.escape(id)}"]`).getAttribute('transform'), id);

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();

// ============ DRAG ============
await seed(page, data);

// Pick a node with at least one edge so we can watch an incident edge move.
const pick = await page.evaluate(() => {
  const e = document.querySelector('#edge-layer .edge:not(.hidden)');
  return { id: e.dataset.from, other: e.dataset.to };
});
const t0 = await transformOf(page, pick.id);
const edgeD0 = await page.evaluate((id) => {
  const e = document.querySelector(`#edge-layer .edge[data-from="${CSS.escape(id)}"], #edge-layer .edge[data-to="${CSS.escape(id)}"]`);
  return e.querySelector('path').getAttribute('d');
}, pick.id);

const c = await nodeCenter(page, pick.id);
await page.mouse.move(c.x, c.y);
await page.mouse.down();
await page.mouse.move(c.x + 140, c.y + 90, { steps: 8 });
await page.mouse.up();

const t1 = await transformOf(page, pick.id);
const edgeD1 = await page.evaluate((id) => {
  const e = document.querySelector(`#edge-layer .edge[data-from="${CSS.escape(id)}"], #edge-layer .edge[data-to="${CSS.escape(id)}"]`);
  return e.querySelector('path').getAttribute('d');
}, pick.id);
const panelOpenAfterDrag = await page.evaluate(() => !document.getElementById('detail-panel').classList.contains('closed'));

ok('drag moves the node transform', t1 !== t0, `${t0} -> ${t1}`);
ok('drag redraws the incident edge path', edgeD1 !== edgeD0);
ok('drag does NOT open the detail panel', panelOpenAfterDrag === false);

// Persistence: reload → dragged position kept.
await page.reload();
await page.waitForSelector('.node', { timeout: 5000 });
const t2 = await transformOf(page, pick.id);
ok('dragged position persists across reload', t2 === t1, `${t1} vs ${t2}`);

// ============ CLICK vs DRAG ============
// Plain click (no movement) still opens the panel + focuses.
const c2 = await nodeCenter(page, pick.id);
await page.mouse.click(c2.x, c2.y);
const panelOpen = await page.evaluate(() => !document.getElementById('detail-panel').classList.contains('closed'));
ok('click without movement opens the panel', panelOpen);

// ============ FOCUS ============
const focusState = await page.evaluate((id) => {
  const nodes = [...document.querySelectorAll('#node-layer .node')];
  const focused = document.querySelector(`#node-layer .node[data-id="${CSS.escape(id)}"]`);
  return {
    focusing: document.body.classList.contains('focusing'),
    dimCount: nodes.filter(n => n.classList.contains('dim')).length,
    focusedDimmed: focused.classList.contains('dim'),
    focusedHi: focused.classList.contains('hi'),
  };
}, pick.id);
ok('node click enters focus mode (body.focusing)', focusState.focusing);
ok('node click dims non-neighbours (dim count > 0)', focusState.dimCount > 0, `dim=${focusState.dimCount}`);
ok('focused node itself is not dimmed', focusState.focusedDimmed === false && focusState.focusedHi === true);
const neighborNotDimmed = await page.evaluate((other) =>
  !document.querySelector(`#node-layer .node[data-id="${CSS.escape(other)}"]`).classList.contains('dim'), pick.other);
ok('a neighbour of the focused node is not dimmed', neighborNotDimmed);

// Background click clears focus.
await page.evaluate(() => {
  const s = document.getElementById('diagram').getBoundingClientRect();
  // click a far corner unlikely to hit a node
  document.getElementById('diagram').dispatchEvent(new MouseEvent('click', { clientX: s.left + 4, clientY: s.top + 4, bubbles: true }));
});
const clearedByBg = await page.evaluate(() => document.body.classList.contains('focusing'));
ok('background click clears focus', clearedByBg === false);

// Re-focus, then Escape clears.
await clickNodeEl(page, pick.id);
const refocused = await page.evaluate(() => document.body.classList.contains('focusing'));
await page.keyboard.press('Escape');
const clearedByEsc = await page.evaluate(() => document.body.classList.contains('focusing'));
ok('Escape clears focus', refocused === true && clearedByEsc === false);

// ============ EDGE FOCUS ============
const edgeInfo = await page.evaluate(() => {
  const e = document.querySelector('#edge-layer .edge:not(.hidden)');
  const hit = e.querySelector('path.hit-path').getBoundingClientRect();
  return { from: e.dataset.from, to: e.dataset.to, x: hit.left + hit.width / 2, y: hit.top + hit.height / 2 };
});
// Dispatch a click directly on the edge group (hit-path geometry can be thin).
const edgeFocus = await page.evaluate(({ from, to }) => {
  const e = document.querySelector('#edge-layer .edge:not(.hidden)');
  e.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const nodesHi = [from, to].every(id => document.querySelector(`#node-layer .node[data-id="${CSS.escape(id)}"]`).classList.contains('hi'));
  return { focusing: document.body.classList.contains('focusing'), edgeHi: e.classList.contains('hi'), endpointsHi: nodesHi };
}, edgeInfo);
ok('edge click enters focus mode', edgeFocus.focusing);
ok('edge click highlights the edge (.hi)', edgeFocus.edgeHi);
ok('edge click focuses both endpoints (.hi)', edgeFocus.endpointsHi);
await page.keyboard.press('Escape');

// ============ RESET clears focus ============
await clickNodeEl(page, pick.id);
const beforeReset = await page.evaluate(() => document.body.classList.contains('focusing'));
await page.click('#reset-btn');
const afterReset = await page.evaluate(() => ({
  focusing: document.body.classList.contains('focusing'),
  dim: document.querySelectorAll('#node-layer .node.dim').length,
}));
ok('Reset clears focus', beforeReset === true && afterReset.focusing === false && afterReset.dim === 0, JSON.stringify(afterReset));

// ============ FOCUS + PROPOSED FIXTURE ============
await seed(page, fixture);
// Focus existing_tbl (connected to both proposed FK edges).
await page.mouse.click((await nodeCenter(page, 'existing_tbl')).x, (await nodeCenter(page, 'existing_tbl')).y);
const proposed = await page.evaluate(() => {
  // Find a proposed edge (violet) incident to existing_tbl.
  const edges = [...document.querySelectorAll('#edge-layer .edge')];
  const violet = edges.find(e => {
    const p = e.querySelector('path:not(.hit-path)');
    return p && p.getAttribute('stroke') === '#8b5cf6';
  });
  if (!violet) return { found: false };
  const p = violet.querySelector('path:not(.hit-path)');
  return {
    found: true,
    stroke: p.getAttribute('stroke'),
    dash: p.getAttribute('stroke-dasharray'),
    hi: violet.classList.contains('hi'),
    dim: violet.classList.contains('dim'),
    focusing: document.body.classList.contains('focusing'),
  };
});
ok('proposed edge found under focus', proposed.found);
ok('proposed edge keeps violet stroke under focus', proposed.stroke === '#8b5cf6', proposed.stroke);
ok('proposed edge keeps dash under focus', !!proposed.dash, proposed.dash);
ok('proposed edge incident to focus is highlighted not dimmed', proposed.hi === true && proposed.dim === false);

// dim MUST win over arb-ignored: seed an ignore on proposed_tbl, focus other_tbl
// (proposed_tbl is a NON-neighbour there) → the ignored+dimmed node reads .15,
// not the .35 arb-ignored opacity.
await page.evaluate(() => localStorage.setItem('flatbase.arbitration.proposed-fixture', JSON.stringify({ 'table::proposed_tbl': { ignore: true } })));
await page.reload();
await page.waitForSelector('.node', { timeout: 5000 });
const ignoredAlone = await page.evaluate(() =>
  getComputedStyle(document.querySelector('#node-layer .node[data-id="proposed_tbl"]')).opacity);
await clickNodeEl(page, 'other_tbl');
const dimWins = await page.evaluate(() => {
  const n = document.querySelector('#node-layer .node[data-id="proposed_tbl"]');
  return { dim: n.classList.contains('dim'), opacity: getComputedStyle(n).opacity };
});
ok('arb-ignored node reads .35 before focus', Math.abs(+ignoredAlone - 0.35) < 1e-6, ignoredAlone);
ok('dim wins over arb-ignored under focus (.15)', dimWins.dim === true && Math.abs(+dimWins.opacity - 0.15) < 1e-6, JSON.stringify(dimWins));

await page.screenshot({ path: path.join(OUT, 'drag-focus-final.png') });
await browser.close();
console.log(results.join('\n'));
console.log(process.exitCode ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED');
