// E2E: crow's-foot cardinality marks — fork=many, tick=one on has_many/has_one/
// many_to_many; extends/polymorphic keep arrow/dash; proposed marks violet, no dash;
// marks move on drag; frozen export carries marks.
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

// count 'M' subpath moves: fork = 3, tick = 1.
const forks = d => (d.match(/M/g) || []).length;

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();

await seed(page, data);

// Inspect one edge of each converted type. Report the mark 'd' + node bounds so we
// can assert symbol (M-count), end (data-end), and proximity to the correct node.
const inspect = await page.evaluate(() => {
  const nodeRect = id => {
    const g = document.querySelector(`#node-layer .node[data-id="${CSS.escape(id)}"]`);
    if (!g) return null;
    const r = g.querySelector('rect');
    return { x: +r.getAttribute('x') || 0, y: +r.getAttribute('y') || 0 };
  };
  // node-layer nodes are transform-translated groups; use transform for world pos.
  const worldPos = id => {
    const g = document.querySelector(`#node-layer .node[data-id="${CSS.escape(id)}"]`);
    const t = g.getAttribute('transform') || '';
    const m = t.match(/translate\(([-\d.]+)[ ,]+([-\d.]+)\)/);
    return m ? { x: +m[1], y: +m[2] } : { x: 0, y: 0 };
  };
  const NODE_W = 190, NODE_H = 72;
  const out = [];
  for (const g of document.querySelectorAll('#edge-layer .edge')) {
    const edge = g.__edge;
    if (!edge) continue;
    const line = g.querySelector('path.edge-line');
    const markers = [...g.querySelectorAll('.edge-marker')].map(m => ({
      end: m.dataset.end,
      d: m.getAttribute('d'),
      stroke: m.getAttribute('stroke'),
      dash: m.getAttribute('stroke-dasharray'),
      Mcount: (m.getAttribute('d').match(/M/g) || []).length,
    }));
    // first point of each marker path (near the node edge)
    const firstPt = d => { const m = d.match(/M\s*([-\d.]+)\s+([-\d.]+)/); return m ? { x: +m[1], y: +m[2] } : null; };
    out.push({
      type: edge.type,
      from: edge.from, to: edge.to,
      proposed: !!edge.proposed,
      hasLineDash: !!(line && line.getAttribute('stroke-dasharray')),
      markerEnd: line ? line.getAttribute('marker-end') : null,
      markers,
      fromPos: worldPos(edge.from),
      toPos: worldPos(edge.to),
      markerPts: markers.map(m => ({ end: m.end, pt: firstPt(m.d) })),
      NODE_W, NODE_H,
    });
  }
  return out;
});

// Proximity: is point P within `pad` of node box [pos, pos+W/H]?
const near = (p, pos, W, H, pad = FORK_D_PAD) => p &&
  p.x >= pos.x - pad && p.x <= pos.x + W + pad &&
  p.y >= pos.y - pad && p.y <= pos.y + H + pad;
const FORK_D_PAD = 16;

// ---- has_many: tick at from (parent/one), fork at to (child/many, FK holder) ----
const hm = inspect.find(e => e.type === 'has_many' && !e.proposed);
ok('has_many edge present', !!hm, hm ? `${hm.from}->${hm.to}` : 'none');
if (hm) {
  ok('has_many has two markers', hm.markers.length === 2, JSON.stringify(hm.markers.map(m => m.end + ':' + m.Mcount)));
  const mf = hm.markers.find(m => m.end === 'from'), mt = hm.markers.find(m => m.end === 'to');
  ok('has_many: tick (1 stroke) at parent/from', mf && mf.Mcount === 1, mf && `M=${mf.Mcount}`);
  ok('has_many: fork (3 prong) at child/to', mt && mt.Mcount === 3, mt && `M=${mt.Mcount}`);
  const pf = hm.markerPts.find(m => m.end === 'from').pt, pt = hm.markerPts.find(m => m.end === 'to').pt;
  ok('has_many: from-mark sits on the parent node', near(pf, hm.fromPos, hm.NODE_W, hm.NODE_H));
  ok('has_many: to-mark (fork) sits on the child node', near(pt, hm.toPos, hm.NODE_W, hm.NODE_H));
  ok('has_many: line has NO arrow marker-end', !hm.markerEnd);
}

// ---- has_one: tick both ends ----
const ho = inspect.find(e => e.type === 'has_one');
if (ho) {
  ok('has_one: tick/tick (both 1 stroke)', ho.markers.length === 2 && ho.markers.every(m => m.Mcount === 1),
    JSON.stringify(ho.markers.map(m => m.end + ':' + m.Mcount)));
} else {
  results.push('SKIP  has_one — none in bookstore schema');
}

// ---- many_to_many: fork both ends, no marker-end arrow ----
const mm = inspect.find(e => e.type === 'many_to_many');
if (mm) {
  ok('many_to_many: fork/fork (both 3 prong)', mm.markers.length === 2 && mm.markers.every(m => m.Mcount === 3),
    JSON.stringify(mm.markers.map(m => m.end + ':' + m.Mcount)));
  ok('many_to_many: no arrow marker-end', !mm.markerEnd);
} else {
  results.push('SKIP  many_to_many — none in bookstore schema');
}

// ---- extends: unchanged (arrow + dash, NO crow's-foot markers) ----
const ex = inspect.find(e => e.type === 'extends');
if (ex) {
  ok('extends: keeps arrow marker-end', ex.markerEnd === 'url(#arrow)', ex.markerEnd);
  ok('extends: has NO crow-foot markers', ex.markers.length === 0);
  ok('extends: line stays dashed', ex.hasLineDash);
} else {
  results.push('SKIP  extends — none in bookstore schema');
}

// ---- polymorphic: unchanged (arrow + dot-dash, NO crow's-foot markers) ----
const poly = inspect.find(e => e.type === 'polymorphic');
if (poly) {
  ok('polymorphic: keeps arrow marker-end', poly.markerEnd === 'url(#arrow)', poly.markerEnd);
  ok('polymorphic: has NO crow-foot markers', poly.markers.length === 0);
  ok('polymorphic: line stays dashed', poly.hasLineDash);
} else {
  results.push('SKIP  polymorphic — none in bookstore schema');
}

// ---- DRAG moves the marks ---------------------------------------------------
const dragId = hm ? hm.to : inspect[0].to;
const markBefore = await page.evaluate((id) => {
  const g = document.querySelector(`#edge-layer .edge[data-to="${CSS.escape(id)}"]`);
  const m = g && g.querySelector('.edge-marker[data-end="to"]');
  return m ? m.getAttribute('d') : null;
}, dragId);
const c = await page.evaluate((id) => {
  const g = document.querySelector(`#node-layer .node[data-id="${CSS.escape(id)}"]`);
  const r = g.querySelector('rect').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, dragId);
await page.mouse.move(c.x, c.y);
await page.mouse.down();
await page.mouse.move(c.x + 120, c.y + 80, { steps: 8 });
const markMid = await page.evaluate((id) => {
  const g = document.querySelector(`#edge-layer .edge[data-to="${CSS.escape(id)}"]`);
  const m = g && g.querySelector('.edge-marker[data-end="to"]');
  return m ? m.getAttribute('d') : null;
}, dragId);
await page.mouse.up();
ok('crow-foot mark moves during drag', markBefore && markMid && markBefore !== markMid,
  `${markBefore ? markBefore.slice(0, 20) : 'nil'} -> ${markMid ? markMid.slice(0, 20) : 'nil'}`);
ok('dragged mark stays a fork (3 prong)', markMid && forks(markMid) === 3, markMid && `M=${forks(markMid)}`);

// ---- PROPOSED fixture: violet marks, no dash on the marks --------------------
await seed(page, fixture);
const prop = await page.evaluate(() => {
  for (const g of document.querySelectorAll('#edge-layer .edge')) {
    const e = g.__edge;
    if (!e || !e.proposed) continue;
    const markers = [...g.querySelectorAll('.edge-marker')].map(m => ({
      end: m.dataset.end,
      stroke: m.getAttribute('stroke'),
      dash: m.getAttribute('stroke-dasharray'),
      computedDash: getComputedStyle(m).strokeDasharray,
      Mcount: (m.getAttribute('d').match(/M/g) || []).length,
    }));
    if (markers.length) return { type: e.type, markers };
  }
  return null;
});
ok('proposed edge has crow-foot markers', prop && prop.markers.length > 0, prop ? prop.type : 'none');
if (prop) {
  ok('proposed marks are violet', prop.markers.every(m => m.stroke === '#8b5cf6'),
    JSON.stringify(prop.markers.map(m => m.stroke)));
  ok('proposed marks carry NO dash (attr)', prop.markers.every(m => m.dash === 'none'),
    JSON.stringify(prop.markers.map(m => m.dash)));
  ok('proposed marks carry NO dash (computed)', prop.markers.every(m => m.computedDash === 'none'),
    JSON.stringify(prop.markers.map(m => m.computedDash)));
}

// ---- FROZEN export carries marks --------------------------------------------
await seed(page, data);
const frozenHTML = await page.evaluate(() => buildFrozenHTML(RAW_INPUT));
const frozenPath = path.join(OUT, 'frozen-crowsfoot.html');
fs.writeFileSync(frozenPath, frozenHTML);
const fpage = await (await browser.newContext()).newPage();
await fpage.goto('file://' + frozenPath);
await fpage.waitForSelector('.node', { timeout: 5000 });
const frozenMarks = await fpage.evaluate(() => {
  let forkCount = 0, tickCount = 0;
  for (const m of document.querySelectorAll('#edge-layer .edge-marker')) {
    const n = (m.getAttribute('d').match(/M/g) || []).length;
    if (n === 3) forkCount++; else if (n === 1) tickCount++;
  }
  return { forkCount, tickCount, total: document.querySelectorAll('.edge-marker').length };
});
ok('frozen export renders crow-foot marks', frozenMarks.total > 0, JSON.stringify(frozenMarks));
ok('frozen export has both forks and ticks', frozenMarks.forkCount > 0 && frozenMarks.tickCount > 0, JSON.stringify(frozenMarks));

await page.screenshot({ path: path.join(OUT, 'crowsfoot-final.png') });
await browser.close();
console.log(results.join('\n'));
console.log(process.exitCode ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED');
