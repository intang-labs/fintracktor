// Drives the built app in Chromium and checks the pace maths, the sheet, the
// history list and both CSV exports. Run: node tools/smoke-test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, normalize } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(req.url.split('?')[0]));
  if (p === '/' || p.endsWith('/')) p += 'index.html';
  try {
    const body = await readFile(resolve(ROOT, '.' + p));
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const fails = [];
const check = (name, got, want) => {
  const ok = String(got) === String(want);
  console.log(`${ok ? '  ok  ' : '  FAIL'}  ${name}${ok ? '' : `\n          got:  ${got}\n          want: ${want}`}`);
  if (!ok) fails.push(name);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', e => errors.push(e.message));

// A fixed clock, so the month maths are checkable rather than drifting daily.
await page.addInitScript(() => {
  const FIXED = new Date('2026-08-26T10:00:00').getTime();
  const Real = Date;
  // eslint-disable-next-line no-global-assign
  Date = class extends Real {
    constructor(...a) { return a.length ? new Real(...a) : new Real(FIXED); }
    static now() { return FIXED; }
  };
});

await page.goto(base, { waitUntil: 'networkidle' });

console.log('\nfirst run');
check('empty state prompts for targets', await page.locator('#tab-pace .steps h2').textContent(),
  'Two steps and this fills itself in.');
check('fab is present', await page.locator('#fab').isVisible(), 'true');

console.log('\nsetup: targets');
await page.click('nav button[data-tab="setup"]');
await page.fill('#tSaveAmt', '1000000');
await page.fill('#tSaveMonth', '2027-03');
await page.fill('#tInvAmt', '2000000');
await page.fill('#tInvMonth', '2028-03');
await page.locator('#tInvMonth').blur();
check('savings amount reformats with locale grouping', await page.inputValue('#tSaveAmt'), '10,00,000');

console.log('\nlogging entries');
// The + button is deliberately absent on Setup, so come back to Pace first.
check('fab is hidden on setup', await page.locator('#fab').isVisible(), 'false');
await page.click('nav button[data-tab="pace"]');
for (const [date, sav, inv] of [
  ['2026-05-26', '520000', '815000'],
  ['2026-06-24', '558000', '870000'],
  ['2026-07-26', '596000', '925000'],
  ['2026-08-26', '642000', '980000'],
]) {
  await page.click('#fab');
  await page.waitForTimeout(360);
  await page.fill('#fDate', date);
  await page.fill('#fSave', sav);
  await page.fill('#fInv', inv);
  await page.click('#saveEntry');
  await page.waitForTimeout(380);
}
check('derived contribution hint appeared while typing', errors.length, 0);

console.log('\npace maths');
// Baseline is the 26 Jul figure (596,000). Target 10,00,000 by Mar 2027 leaves
// 8 months counting August, so 50,500 a month, and August should end at 646,500.
check('headline is savings + invested', await page.locator('#tab-pace .total').textContent(), '₹16,22,000');
check('month-end savings target', await page.locator('#tab-pace .month-target').textContent(), '₹6,46,500');
check('amount still to go this month',
  (await page.locator('#tab-pace .card:nth-of-type(2) .foot span').nth(1).textContent()).trim(), '₹4,500 TO GO');
check('savings needs per month',
  await page.locator('#tab-pace .card:nth-of-type(3) .foot b').first().textContent(), '₹50,500');
check('savings reads behind',
  await page.locator('#tab-pace .card:nth-of-type(3) .chip').textContent(), 'Behind');
check('invested reads on pace',
  await page.locator('#tab-pace .card:nth-of-type(4) .chip').textContent(), 'On pace');
check('invested counts contributions, not value',
  await page.locator('#tab-pace .card:nth-of-type(4) .track-now .big').textContent(), '₹9,80,000');

console.log('\nhistory');
await page.click('nav button[data-tab="history"]');
check('all four entries listed', await page.locator('#tab-history .swipe').count(), 4);
check('newest first', await page.locator('#tab-history .entry-total').first().textContent(), '₹16,22,000');
check('derived contribution shown', await page.locator('#tab-history .chip').first().textContent(), '+₹55,000');

console.log('\nediting');
await page.locator('#tab-history .face').first().click();
await page.waitForTimeout(360);
check('sheet opens in edit mode', await page.locator('#sheetTitle').textContent(), 'Edit entry');
check('savings prefilled', await page.inputValue('#fSave'), '6,42,000');
await page.click('#sheetClose');
await page.waitForTimeout(340);

console.log('\nexports');
await page.click('nav button[data-tab="setup"]');
for (const [id, name] of [['#btnCsvEntries', 'entries'], ['#btnCsvSummary', 'summary'], ['#btnJson', 'backup']]) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(id)]);
  check(`${name} download starts`, dl.suggestedFilename(), `fintracktor-${name}-2026-08-26.${name === 'backup' ? 'json' : 'csv'}`);
  if (name === 'entries') {
    const text = await readFile(await dl.path(), 'utf8');
    check('entries csv header', text.split('\r\n')[0], 'Date,Savings,Invested,Added,Total,Note');
    check('entries csv derives the contribution', text.split('\r\n')[4], '2026-08-26,642000,980000,55000,1622000,');
  }
}
check('export age chip appears', await page.locator('#exportAge').textContent(), 'today');

console.log('\npersistence');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
check('entries survive a reload', await page.locator('#tab-pace .total').textContent(), '₹16,22,000');

check('no console errors', errors.join(' | ') || 'none', 'none');

await page.screenshot({ path: 'tools/shot-pace.png', fullPage: true });
await page.click('nav button[data-tab="history"]');
await page.waitForTimeout(200);
await page.screenshot({ path: 'tools/shot-history.png', fullPage: true });
await page.click('nav button[data-tab="setup"]');
await page.waitForTimeout(200);
await page.screenshot({ path: 'tools/shot-setup.png', fullPage: true });
await page.click('nav button[data-tab="pace"]');
await page.click('#fab');
await page.waitForTimeout(420);
await page.screenshot({ path: 'tools/shot-sheet.png' });

await browser.close();
server.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}\n` : '\nall checks passed\n');
process.exit(fails.length ? 1 : 0);
