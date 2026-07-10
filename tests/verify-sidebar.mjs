// E2E verification: sidebar search, live domain color, table counts.
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

const nTables = JSON.parse(data).tables.length;

// 1. Counts
const counts = await page.evaluate(() => ({
  global: document.getElementById('sidebar-count').textContent,
  domains: [...document.querySelectorAll('.sidebar-domain-count')].map(e => e.textContent),
}));
ok('global count shows total', counts.global === nTables + ' tables', JSON.stringify(counts));
ok('per-domain counts present', counts.domains.length > 1 && counts.domains.every(c => /^\d+$/.test(c)));

// 2. Search
await page.fill('#sidebar-search', 'book');
const searched = await page.evaluate(() => ({
  rows: [...document.querySelectorAll('#sidebar-list .sidebar-table .table-name-en')].map(e => e.textContent),
  global: document.getElementById('sidebar-count').textContent,
  domainCounts: [...document.querySelectorAll('.sidebar-domain-count')].map(e => e.textContent),
  nodesStillAll: document.querySelectorAll('.node:not(.hidden)').length,
}));
ok('search filters sidebar rows', searched.rows.length > 0 && searched.rows.every(n => n.toLowerCase().includes('book')), JSON.stringify(searched.rows));
ok('search count shows shown/total', new RegExp('^' + searched.rows.length + ' / ' + nTables + ' tables$').test(searched.global), searched.global);
ok('filtered domain count uses n/m', searched.domainCounts.some(c => /^\d+\/\d+$/.test(c)), JSON.stringify(searched.domainCounts));
ok('diagram untouched by search', searched.nodesStillAll === nTables, String(searched.nodesStillAll));
// no-match case
await page.fill('#sidebar-search', 'zzzznothing');
const noneShown = await page.evaluate(() => ({
  rows: document.querySelectorAll('#sidebar-list .sidebar-table').length,
  global: document.getElementById('sidebar-count').textContent,
}));
ok('no-match search: empty list + 0 count', noneShown.rows === 0 && noneShown.global === '0 / ' + nTables + ' tables', JSON.stringify(noneShown));
// clear via Reset
await page.click('#menu-btn'); await page.click('#reset-btn');
const afterReset = await page.evaluate(() => ({
  val: document.getElementById('sidebar-search').value,
  rows: document.querySelectorAll('#sidebar-list .sidebar-table').length,
}));
ok('Reset clears search', afterReset.val === '' && afterReset.rows === nTables, JSON.stringify(afterReset));
await page.screenshot({ path: path.join(OUT, 'sidebar-counts.png') });

// 3. Live domain color
const firstDomain = await page.evaluate(() => DOMAIN_ORDER[0]);
const before = await page.evaluate(d => ({
  chip: [...document.querySelectorAll('.domain-chip')][0].style.background,
  node: document.querySelector('.node rect').getAttribute('stroke'),
}), firstDomain);
// drive the real <input type=color> via input event (pickers can't be automated natively)
await page.evaluate(() => {
  const inp = document.querySelector('.domain-chip input[type="color"]');
  inp.value = '#ff0080';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
});
const after = await page.evaluate(d => {
  const t = DATA.tables.find(x => x.domain === d);
  return {
    domainColors: DOMAIN_COLORS[d],
    nodeStroke: document.querySelector(`.node[data-id="${t.id}"] rect`).getAttribute('stroke'),
    sidebarLabel: document.querySelector('.sidebar-domain-label').style.color,
    chipBg: [...document.querySelectorAll('.domain-chip')][0].style.backgroundColor,
    rawDomains: RAW_INPUT.domains && RAW_INPUT.domains.find(x => x.id === d)?.color,
    cached: JSON.parse(localStorage.getItem('flatbase.tables.json')).domains?.find(x => x.id === d)?.color,
  };
}, firstDomain);
ok('color applied to state + node + sidebar + chip',
  after.domainColors === '#ff0080' && after.nodeStroke === '#ff0080' &&
  after.sidebarLabel === 'rgb(255, 0, 128)' && after.chipBg === 'rgb(255, 0, 128)', JSON.stringify(after));
ok('color persisted to RAW_INPUT + localStorage cache', after.rawDomains === '#ff0080' && after.cached === '#ff0080');
// survives reload
await page.reload();
await page.waitForSelector('.node', { timeout: 5000 });
const reloaded = await page.evaluate(d => DOMAIN_COLORS[d], firstDomain);
ok('color survives reload', reloaded === '#ff0080', reloaded);
await page.screenshot({ path: path.join(OUT, 'recolored.png') });

// 4. Frozen export carries the color + the new sidebar UI
await page.click('#menu-btn');                 // ↓ Export now lives in the hamburger menu
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-btn')]);
const frozenPath = path.join(OUT, 'frozen-sidebar.html');
await dl.saveAs(frozenPath);
const page2 = await ctx.newPage();
await page2.goto('file://' + frozenPath);
await page2.waitForSelector('.node', { timeout: 5000 });
const frozen = await page2.evaluate(d => ({
  color: DOMAIN_COLORS[d],
  hasSearch: !!document.getElementById('sidebar-search'),
  count: document.getElementById('sidebar-count').textContent,
}), firstDomain);
await page2.fill('#sidebar-search', 'book');
const frozenSearch = await page2.evaluate(() => document.querySelectorAll('#sidebar-list .sidebar-table').length);
ok('frozen: color baked + search bar works + counts', frozen.color === '#ff0080' && frozen.hasSearch && /tables$/.test(frozen.count) && frozenSearch > 0, JSON.stringify({ ...frozen, frozenSearch }));

// 5. Regression: proposed fixture still fine with the new sidebar (arb badges, counts)
const fixture = fs.readFileSync(path.join(REPO, 'docs/proposed-fixture.json'), 'utf8');
await page.evaluate(f => { localStorage.clear(); localStorage.setItem('flatbase.tables.json', f); }, fixture);
await page.reload();
await page.waitForSelector('.node', { timeout: 5000 });
const fx = await page.evaluate(() => ({
  count: document.getElementById('sidebar-count').textContent,
  proposalBtn: getComputedStyle(document.getElementById('export-proposal-btn')).display !== 'none',
  badges: [...document.querySelectorAll('#sidebar-list .badge.proposed')].length,
}));
ok('regression: proposed fixture renders (count, ↓ Proposal, badges)', fx.count === '3 tables' && fx.proposalBtn && fx.badges === 1, JSON.stringify(fx));

await browser.close();
console.log(results.join('\n'));
