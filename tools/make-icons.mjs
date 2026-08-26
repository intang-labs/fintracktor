// Renders the Fintracktor mark to PNG at the sizes a PWA needs.
// Chromium does the rasterising, so there is no image library to install.
// Run: node tools/make-icons.mjs
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const TEAL = '#0F8A7E';

// The mark: a rising chart line, same shape as the wordmark in the header.
// Drawn on a 24 grid, then mapped into a box inside the icon.
const PTS = [[4, 18], [10, 12], [14, 15], [20, 6]];

function glyph(size, inset) {
  const box = size - inset * 2;
  const s = box / 24;
  const pts = PTS.map(([x, y]) => `${(inset + x * s).toFixed(1)},${(inset + y * s).toFixed(1)}`).join(' ');
  return `<polyline points="${pts}" fill="none" stroke="#fff" stroke-width="${(s * 2.6).toFixed(1)}"
    stroke-linecap="round" stroke-linejoin="round"/>`;
}

function svg(size, { radius, inset }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${radius}" fill="${TEAL}"/>
    ${glyph(size, inset)}
  </svg>`;
}

// inset is larger on the maskable icon so the glyph survives an aggressive crop.
const ICONS = [
  { name: 'icon-192.png',       size: 192, radius: 43,  inset: 30 },
  { name: 'icon-512.png',       size: 512, radius: 114, inset: 80 },
  { name: 'icon-maskable.png',  size: 512, radius: 0,   inset: 128 },
  { name: 'apple-touch-icon.png', size: 180, radius: 0, inset: 28 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
for (const { name, size, radius, inset } of ICONS) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(
    `<body style="margin:0">${svg(size, { radius, inset })}</body>`,
    { waitUntil: 'load' }
  );
  writeFileSync(`${OUT}/${name}`, await page.screenshot({ omitBackground: true }));
  await page.close();
  console.log(`${name}  ${size}x${size}`);
}
await browser.close();

// A vector favicon for browsers that prefer one.
writeFileSync(`${OUT}/favicon.svg`, svg(64, { radius: 14, inset: 10 }) + '\n');
console.log('favicon.svg');
