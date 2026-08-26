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

### Entering it

Nobody thinks "my running total is now ₹3,15,000"; they think "I put in ₹15,000
this month". So the invested field takes a **contribution** by default and shows
the resulting total underneath. A **Total** switch is there for when you would
rather type the cumulative figure — correcting a mistake, or catching up after a
gap — and whatever is already typed converts across when you switch.

The first entry has no switch: with nothing before it, there is nothing to add to,
so it asks for everything you have put in to date.

Entering a contribution into the Total field is the easy mistake, and it reads as
a large loss. Any entry that lowers the running total is challenged before it is
stored, naming both figures.

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
is no build command.

Getting a deploy onto an already-installed phone is the fiddly part, so it is
worth being explicit. The service worker treats `/icons/` as cache-first, since
those change only by changing name, and **everything else network-first**: the
network decides what the code is, and the cache is the offline fallback. Serving
markup, JavaScript or CSS from the cache would pin an installed app to whatever
shipped first — new HTML running against old code, which is a real bug this
project has already shipped once.

`netlify.toml` backs that up with `must-revalidate` on the shell, the worker, the
manifest, `app.js` and `styles.css`; icons are immutable and cached for a year.
When a new worker replaces one already in charge, the page offers a **Reload**
prompt rather than swapping itself underneath you mid-entry.

Bumping `VERSION` in `public/sw.js` drops every response cached by an older
release. With network-first that is a belt-and-braces measure rather than a
requirement, but it is still the right thing to do when a release changes the
shape of what is cached.

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
