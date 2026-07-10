// E2E verification: free tags replace planned/modeled labels.
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
await page.evaluate(f => localStorage.setItem('flatbase.tables.json', f), data);
await page.reload();
await page.waitForSelector('.node', { timeout: 5000 });

// 1. No "planned"/"modeled" text anywhere (SVG + sidebar)
const noPlanned = await page.evaluate(() => {
  const svgTexts = [...document.querySelectorAll('svg text')].map(t => t.textContent);
  const sidebarBadges = [...document.querySelectorAll('#sidebar-list .badge')].map(b => b.textContent);
  return {
    svgPlanned: svgTexts.filter(t => /planned|modeled/.test(t)),
    sbPlanned: sidebarBadges.filter(t => /planned|modeled/.test(t)),
  };
});
ok('no planned/modeled text in SVG or sidebar', noPlanned.svgPlanned.length === 0 && noPlanned.sbPlanned.length === 0, JSON.stringify(noPlanned));

// 2. Node tag label on book (#mvp #core)
const nodeTag = await page.evaluate(() => {
  const g = document.querySelector('.node[data-id="book"]');
  return [...g.querySelectorAll('text')].map(t => t.textContent).find(t => t.startsWith('#'));
});
ok('book node shows tag label', nodeTag === '#mvp #core', String(nodeTag));

// 3. Dashed border preserved on cart (modeled:false), no textual label
const cart = await page.evaluate(() => {
  const g = document.querySelector('.node[data-id="cart"]');
  return {
    dash: g.querySelector('rect').getAttribute('stroke-dasharray'),
    tag: [...g.querySelectorAll('text')].map(t => t.textContent).find(t => t.startsWith('#')),
  };
});
ok('cart keeps dashed border + shows #phase-2', cart.dash === '5,3' && cart.tag === '#phase-2', JSON.stringify(cart));

// 4. Sidebar tag chips
const sbTags = await page.evaluate(() =>
  [...document.querySelectorAll('#sidebar-list .badge.tag')].map(b => b.textContent));
ok('sidebar renders tag chips', sbTags.includes('#mvp') && sbTags.includes('#phase-2'), JSON.stringify(sbTags));

// 5. Search matches tags
await page.fill('#sidebar-search', 'mvp');
const searchHit = await page.evaluate(() =>
  [...document.querySelectorAll('#sidebar-list .sidebar-table .table-name-en')].map(e => e.textContent));
ok('search "mvp" matches tagged table', searchHit.length === 1 && searchHit[0] === 'Book', JSON.stringify(searchHit));
await page.click('#menu-btn'); await page.click('#reset-btn');

// 6. Detail panel: tag chips, no modeled/planned badge
await page.evaluate(() => openDetailPanel('book'));
const detail = await page.evaluate(() => {
  const p = document.querySelector('.detail-meta-row');
  return {
    tags: [...p.querySelectorAll('.badge.tag')].map(b => b.textContent),
    text: p.textContent,
  };
});
ok('detail panel shows tag chips, no modeled badge',
  detail.tags.join(',') === '#mvp,#core' && !/planned|modeled/.test(detail.text), JSON.stringify(detail));

await page.screenshot({ path: path.join(OUT, 'tags.png') });

// 7. Frozen export carries tags
await page.click('#menu-btn');                 // ↓ Export now lives in the hamburger menu
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-btn')]);
const frozenPath = path.join(OUT, 'frozen-tags.html');
await dl.saveAs(frozenPath);
const page2 = await ctx.newPage();
await page2.goto('file://' + frozenPath);
await page2.waitForSelector('.node', { timeout: 5000 });
const frozenTag = await page2.evaluate(() => {
  const g = document.querySelector('.node[data-id="book"]');
  return [...g.querySelectorAll('text')].map(t => t.textContent).find(t => t.startsWith('#'));
});
ok('frozen export renders tags', frozenTag === '#mvp #core', String(frozenTag));

// 8. Regression: proposed fixture — proposed label intact, tags suppressed on proposed nodes
const fixture = fs.readFileSync(path.join(REPO, 'docs/proposed-fixture.json'), 'utf8');
await page.evaluate(f => { localStorage.clear(); localStorage.setItem('flatbase.tables.json', f); }, fixture);
await page.reload();
await page.waitForSelector('.node', { timeout: 5000 });
const fx = await page.evaluate(() => {
  const g = document.querySelector('.node[data-id="proposed_tbl"]');
  return {
    proposedLabel: [...g.querySelectorAll('text')].some(t => t.textContent === 'proposed'),
    proposalBtn: getComputedStyle(document.getElementById('export-proposal-btn')).display !== 'none',
  };
});
ok('regression: proposed fixture intact', fx.proposedLabel && fx.proposalBtn, JSON.stringify(fx));

// 9. Long tag list truncation on node
const longData = JSON.stringify({
  meta: { project: 'trunc' },
  tables: [{ id: 't1', name: 'T1', domain: 'd', type: 'entity',
             tags: ['very-long-tag-name', 'another-long-one'] }],
});
await page.evaluate(f => { localStorage.clear(); localStorage.setItem('flatbase.tables.json', f); }, longData);
await page.reload();
await page.waitForSelector('.node', { timeout: 5000 });
const trunc = await page.evaluate(() => {
  const g = document.querySelector('.node[data-id="t1"]');
  return [...g.querySelectorAll('text')].map(t => t.textContent).find(t => t.startsWith('#'));
});
ok('long tag label truncated with ellipsis', trunc && trunc.length === 18 && trunc.endsWith('…'), String(trunc));

await browser.close();
console.log(results.join('\n'));
