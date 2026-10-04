// A deploy must reach an installed app. This serves the site, lets the service
// worker take control, then changes app.js and styles.css underneath it and
// reloads — the way a Netlify deploy does. Cache-first sub-resources fail here.
// Run: node tools/sw-freshness-test.mjs
import { chromium } from 'playwright';
import { serve, reporter } from './serve.mjs';

let build = 1;   // flipped to 2 to stand in for a deploy
const { base, close } = await serve((path, body) => {
  if (build !== 2) return body;
  if (path === '/app.js') return `window.__BUILD='v2';\n` + body;
  if (path === '/styles.css') return body + `\n:root{--build:"v2"}\n`;
  return body;
});
const { check, done } = reporter();


const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 15000 });
console.log('\nservice worker is controlling the page');
check('serving the first build', await page.evaluate(() => window.__BUILD || 'v1'), 'v1');

build = 2;                       // a deploy lands
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);

console.log('\nafter a deploy and one reload');
check('app.js is the deployed one', await page.evaluate(() => window.__BUILD || 'v1'), 'v2');
check('styles.css is the deployed one',
  (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--build'))).trim().replace(/"/g, ''),
  'v2');

console.log('\noffline');
await ctx.setOffline(true);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(400);
check('the app still opens with no network', await page.locator('#fab').count(), 1);
check('and styles came from the cache', await page.evaluate(
  () => getComputedStyle(document.body).backgroundColor), 'rgb(242, 244, 247)');
await ctx.setOffline(false);

await browser.close();
close();
done();
