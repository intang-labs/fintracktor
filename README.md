# Fintracktor

A small progressive web app for tracking savings and investments by hand, against
a target and a date. It runs entirely in the browser: no account, no server, no
analytics, and no request ever carries your figures anywhere.

## What it does

You log two numbers whenever you feel like it — what is in the bank, and the
total you have put into investments. From those, and a target for each, the app
works out whether you are keeping pace.

The screen that matters is **the month-end figure**. A target in 2027 is too far
away to push against, so the app divides what is left by the months remaining and
tells you what your balance should be by the end of *this* month, with a bar that
fills as you close the gap.

## Investments mean money you put in

Market value is deliberately out of scope. The app never asks what a portfolio is
worth and never attributes growth, so your invested target is reached when you
have *deposited* that much, whatever the market did in between.

This is a choice, not an oversight. It keeps the number under your control: a
crash cannot tell you that you failed to save, and a rally cannot tell you that
you succeeded. The cost is that Fintracktor will show a smaller figure than your
broker does. Same money, different question.

Because the figure is cumulative, the monthly contribution is just the difference
between two entries — so the app derives it rather than asking, and the entry
form is two numbers rather than three.

## Where the data lives

In IndexedDB on the device, with `localStorage` as a fallback for private windows.
It is never transmitted. That also means it is exactly as durable as the browser
profile holding it: clear site data and it is gone.

So export regularly. Setup offers three:

| Export | Contents |
| --- | --- |
| Entries as CSV | One row per entry, with the derived contribution — import into a sheet |
| Summary as CSV | Targets, pace and monthly figures — a second tab in the same sheet |
| Full backup as JSON | Everything, and the only format `Restore` accepts |

Setup shows how long it has been since the last one.

## Running it

There is no build step and there are no runtime dependencies — `public/` is the
whole site.

```sh
npm run dev     # serve public/ at http://localhost:8080
npm test        # drive the app in Chromium and check the pace maths
npm run icons   # re-render the PNG icons from the vector mark
```

`npm test` needs Playwright, the only dev dependency: `npm install`.

## Deploying

Netlify serves `public/` straight from the repository — see `netlify.toml`. There
is no build command. The shell, the service worker and the manifest are set to
revalidate on every request so a deploy is not left sitting behind a stale cache
on an installed phone; icons are immutable and cached for a year.

When a deploy lands on a phone that already has the app open, the service worker
notices and offers a **Reload** prompt rather than swapping the page underneath you.

To cut a release, bump `VERSION` in `public/sw.js` — that is what drops the old
cache.

## Layout

```
public/           the entire deployed site
  index.html      shell and static forms
  app.js          storage, pace maths, rendering, exports
  styles.css      design tokens and every component
  sw.js           offline cache and update prompt
  icons/          generated — see tools/make-icons.mjs
design/           the multi-artboard design canvas the app was built from
tools/            icon generation and the smoke test
```

`design/*.dc.html` are the source artboards; `design/fintracktor.html` is the
generated canvas bundle and is not committed.
