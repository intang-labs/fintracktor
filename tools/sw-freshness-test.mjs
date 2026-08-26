// A deploy must reach an installed app. This serves the site, lets the service
// worker take control, then changes app.js and styles.css underneath it and
// reloads — the way a Netlify deploy does. Cache-first sub-resources fail here.
// Run: node tools/sw-freshness-test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

let build = 1;   // flipped to 2 to stand in for a deploy
const server = createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(req.url.split('?')[0]));
  if (p === '/' || p.endsWith('/')) p += 'index.html';
  try {
    let body = await readFile(resolve(ROOT, '.' + p));
    if (build === 2 && p === '/app.js') body = `window.__BUILD='v2';\n` + body;
    if (build === 2 && p === '/styles.css') body = body + `\n:root{--build:"v2"}\n`;
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=0, must-revalidate' });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const fails = [];
const check = (name, got, want) => {
  const ok = String(got) === String(want);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `\n          got:  ${got}\n          want: ${want}`}`);
  if (!ok) fails.push(name);
};

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
server.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}\n` : '\nall checks passed\n');
process.exit(fails.length ? 1 : 0);
