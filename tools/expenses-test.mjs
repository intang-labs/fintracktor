// Expenses, the monthly cap, and the Back Tap quick-add URL.
// Run: node tools/expenses-test.mjs
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { serve, freezeClock, reporter } from './serve.mjs';

const { base, close } = await serve();
const { check, done } = reporter();

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', e => errors.push(e.message));

// Mid-October, so there is a month both behind and ahead of today.
await page.addInitScript(freezeClock('2026-10-15T10:00:00'));
await page.goto(base, { waitUntil: 'networkidle' });

// Seed a cap and four expenses; the fifth goes in through the sheet.
await page.evaluate(async () => {
  const doc = {
    v: 2, currency: 'INR', lastExport: null, budget: 45000, entries: [],
    targets: { savings: { amount: 1000000, month: '2027-03' }, invested: { amount: 2000000, month: '2028-03' } },
    expenses: [
      ['2026-10-02', 1200, 'Food', 'lunch'], ['2026-10-05', 800, 'Transport', ''],
      ['2026-10-09', 2000, 'Food', ''], ['2026-10-12', 5000, 'Bills', 'electricity'],
      ['2026-09-20', 9999, 'Food', 'last month'],
    ].map(([date, amount, cat, note], i) => ({ id: 'x' + i, date, amount, cat, note })),
  };
  await new Promise((res, rej) => {
    const r = indexedDB.open('fintracktor', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('state');
    r.onsuccess = () => { const tx = r.result.transaction('state', 'readwrite');
      tx.objectStore('state').put(doc, 'doc'); tx.oncomplete = res; tx.onerror = rej; };
    r.onerror = rej;
  });
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);

console.log('\nlogging an expense with a typed category');
await page.click('#fab');
await page.waitForTimeout(400);
check('the + opens the expense sheet', await page.locator('#xsheetTitle').textContent(), 'New expense');
await page.fill('#xAmt', '1500');
await page.click('#xCats button[data-cat="__other"]');
await page.waitForTimeout(150);
check('Other reveals a name field', await page.locator('#xCatOther').isVisible(), 'true');
await page.fill('#xCatOther', 'gifts');
await page.fill('#xDate', '2026-10-14');
await page.click('#xSave');
await page.waitForTimeout(500);
check('saving lands on Spend', await page.locator('#tab-spend').isVisible(), 'true');
check('a typed category is capitalised', await page.locator('#tab-spend .xcat').first().textContent(), 'Gifts');

console.log('\nthe category becomes reusable');
await page.click('#fab');
await page.waitForTimeout(400);
check('the typed label is now a chip', await page.locator('#xCats button[data-cat="Gifts"]').count(), 1);
await page.click('#xsheetClose');
await page.waitForTimeout(350);

console.log('\nspend tab');
// 1200 + 800 + 2000 + 5000 + 1500 = 10,500, and September is excluded.
check('month total excludes other months',
  await page.locator('#tab-spend .spend-total').textContent(), '₹10,500');
check('what is left of the cap',
  (await page.locator('#tab-spend .card .foot span').nth(1).textContent()).trim(), '₹34,500 LEFT');
check('biggest category leads', await page.locator('#tab-spend .bd-name').first().textContent(), 'Bills');
check('with its amount', await page.locator('#tab-spend .bd-amt').first().textContent(), '₹5,000');
check('and its share', await page.locator('#tab-spend .bd-pct').first().textContent(), '48%');
check('every expense is listed', await page.locator('#tab-spend .swipe').count(), 5);

console.log('\nlooking back a month');
await page.click('#mPrev');
await page.waitForTimeout(250);
check('September opens', await page.locator('#tab-spend .monthnav h1').textContent(), 'Sep 2026');
check('with its own total', await page.locator('#tab-spend .spend-total').textContent(), '₹9,999');
await page.click('#mNext');
await page.waitForTimeout(250);

console.log('\npace: spending against the cap');
await page.click('nav button[data-tab="pace"]');
await page.waitForTimeout(250);
// No balance entries are seeded, so Pace is in its first-run state — the
// spending card still has to appear.
check('spending shows even with no balance entries',
  await page.locator('#tab-pace .card').filter({ hasText: 'Spending by' }).count(), 1);
// Locate it by what it says, not by position — the card order shifts with state.
const paceCard = await page.locator('#tab-pace .card').filter({ hasText: 'Spending by' }).textContent();
check('the cap card shows spend of cap', /₹10,500.*of ₹45,000/s.test(paceCard), 'true');
// 10,500 over 15 days projects to about 21,700 across 31 — comfortably under.
check('and the verdict', /On track to finish under/.test(paceCard), 'true');

console.log('\nback tap: the quick-add URL');
await page.goto(`${base}/?spend=250&cat=food`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
check('the expense is logged', await page.locator('#tab-spend .spend-total').textContent(), '₹10,750');
check('the parameter is stripped', new URL(page.url()).search, '');
check('and an undo is offered', await page.locator('#toast button').textContent(), 'Undo');

console.log('\na refresh must not log it twice');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.click('nav button[data-tab="spend"]');
check('still one quick-added expense', await page.locator('#tab-spend .spend-total').textContent(), '₹10,750');

console.log('\nundoing a misfire');
await page.goto(`${base}/?spend=99&cat=transport`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
check('logged', await page.locator('#tab-spend .spend-total').textContent(), '₹10,849');
await page.click('#toast button');
await page.waitForTimeout(500);
check('undone', await page.locator('#tab-spend .spend-total').textContent(), '₹10,750');

console.log('\nthe same parameters in the hash');
// A webapp:// link has to match the installed URL closely, so the hash form
// is the one more likely to survive. It must behave identically.
await page.goto(`${base}/#spend=300&cat=bills&note=water`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
check('a hash quick-add logs too', await page.locator('#tab-spend .spend-total').textContent(), '₹11,050');
check('the hash is stripped', new URL(page.url()).hash, '');
check('its category came through',
  await page.locator('#tab-spend .swipe').filter({ hasText: '₹300' }).locator('.xcat').textContent(), 'Bills');
await page.click('#toast button');
await page.waitForTimeout(500);
check('and it undoes', await page.locator('#tab-spend .spend-total').textContent(), '₹10,750');

console.log('\nno amount means open the keypad instead');
await page.goto(`${base}/?spend&cat=bills`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
check('the sheet opens', await page.locator('#xsheetTitle').isVisible(), 'true');
check('with the category already chosen',
  await page.locator('#xCats button[data-cat="Bills"]').getAttribute('aria-pressed'), 'true');
await page.click('#xsheetClose');
await page.waitForTimeout(350);

console.log('\nopening the keypad on launch');
await page.click('nav button[data-tab="setup"]');
await page.waitForTimeout(200);
check('the switch starts off', await page.locator('#tOpenSheet').isChecked(), 'false');
check('setup shows the exact shortcut link',
  await page.locator('#appLink').textContent(), `webapp://${new URL(base).host}/`);
await page.click('#tOpenSheet');
await page.waitForTimeout(300);
await page.goto(base, { waitUntil: 'networkidle' });   // a plain launch, no parameter
await page.waitForTimeout(700);
check('a plain launch opens the sheet', await page.locator('#xsheet').isVisible(), 'true');
check('on the Spend tab', await page.locator('#tab-spend').isVisible(), 'true');
await page.click('#xsheetClose');
await page.waitForTimeout(350);
await page.click('nav button[data-tab="setup"]');
await page.click('#tOpenSheet');
await page.waitForTimeout(300);
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
check('off again, and it does not', await page.locator('#xsheet').isVisible(), 'false');

console.log('\nexport');
const [dl] = await Promise.all([page.waitForEvent('download'),
  page.click('nav button[data-tab="setup"]').then(() => page.click('#btnCsvExpenses'))]);
check('expenses csv downloads', dl.suggestedFilename(), 'fintracktor-expenses-2026-10-15.csv');
const text = await readFile(await dl.path(), 'utf8');
check('with a header', text.split('\r\n')[0], 'Date,Amount,Category,Note');
check('and the typed category', /2026-10-14,1500,Gifts,/.test(text), 'true');

check('no console errors', errors.join(' | ') || 'none', 'none');

await page.click('nav button[data-tab="spend"]');
await page.waitForTimeout(250);
await page.screenshot({ path: 'tools/shot-spend.png', fullPage: true });
await page.click('nav button[data-tab="pace"]');
await page.waitForTimeout(250);
await page.screenshot({ path: 'tools/shot-pace.png', fullPage: true });
await page.click('#fab');
await page.waitForTimeout(450);
await page.screenshot({ path: 'tools/shot-expense-sheet.png' });

await browser.close(); close();
done();
