// A static server over public/, shared by the test suites.
// `transform(path, buffer)` may rewrite a response, which is how the service
// worker suite stands in a second build.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml' };

export async function serve(transform) {
  const server = createServer(async (req, res) => {
    let p = normalize(decodeURIComponent(req.url.split('?')[0]));
    if (p === '/' || p.endsWith('/')) p += 'index.html';
    try {
      let body = await readFile(resolve(ROOT, '.' + p));
      if (transform) body = transform(p, body);
      res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=0, must-revalidate' });
      res.end(body);
    } catch { res.writeHead(404).end('not found'); }
  });
  await new Promise(r => server.listen(0, r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

// A clock that does not drift, so month arithmetic is checkable.
export const freezeClock = at => `(() => {
  const FIXED = new Date(${JSON.stringify(at)}).getTime();
  const Real = Date;
  Date = class extends Real {
    constructor(...a) { return a.length ? new Real(...a) : new Real(FIXED); }
    static now() { return FIXED; }
  };
})()`;

export function reporter() {
  const fails = [];
  const check = (name, got, want) => {
    const ok = String(got) === String(want);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `\n          got:  ${got}\n          want: ${want}`}`);
    if (!ok) fails.push(name);
  };
  const done = () => {
    console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}\n` : '\nall checks passed\n');
    process.exit(fails.length ? 1 : 0);
  };
  return { check, done };
}
