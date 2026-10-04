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

## Expenses

Expenses are a **separate record** from the savings balance. You still type your
bank balance by hand each month; nothing here adjusts it. The two are never
reconciled, which is the point — miss a coffee and your balance figure is still
correct, because it was never derived from your expenses in the first place.

Each expense is an amount, a date, a category and an optional note. Categories
are five fixed ones — Food, Transport, Bills, Shopping, Health — plus **Other**,
which lets you type a name. A typed name becomes a chip of its own next time, in
order of first use, so it stays put as history grows.

Set a **monthly cap** in Setup and Pace gains a spending card: what you have
spent, what is left, what that leaves per day, and whether today's rate lands you
over by month end. Without a cap, spending is still recorded, just not measured
against anything.

The breakdown on the Spend tab is ranked by amount in a single hue. Its job is
magnitude — where the money went, biggest first — so the bar length carries the
comparison and the label carries the identity. There is deliberately no
colour-per-category scheme to learn or to fail a colourblind reader.

## Logging an expense from a Back Tap

iOS can run a Shortcut when you tap the back of the phone, and that is as far as
iOS will go: **a Shortcut cannot write into this app's storage.** What it can do
is open a URL carrying the amount, which the app reads on launch:

```
/?spend=250&cat=food&note=lunch
```

`spend` is required; `cat` and `note` are optional. An unknown `cat` becomes a
typed category. The parameter is stripped with `replaceState` *before* anything
is saved, so a refresh can never log the same expense twice, and the confirmation
toast carries an **Undo** for seven seconds — a gesture on the back of a phone
will sometimes fire by accident.

Leave the amount off (`/?spend&cat=bills`) and the app opens the expense sheet
with that category selected instead of saving anything.

### The Shortcut

In the Shortcuts app, make one called *Log expense*:

1. **Ask for Input** — Number — "How much?"
2. **Choose from Menu** — Food, Transport, Bills, Shopping, Health *(optional)*
3. **URL** — `https://YOUR-SITE.netlify.app/?spend=` + the Ask for Input result
   + `&cat=` + the chosen menu item
4. **Open URLs**

Then **Settings → Accessibility → Touch → Back Tap → Double Tap** and pick it.

### One caveat worth testing first

iOS gives a home-screen web app its own storage, separate from Safari. If
Shortcuts' *Open URLs* lands in Safari rather than the installed app, the expense
is written to a copy of Fintracktor that has none of your data.

Check before relying on it: open the app from your home screen and confirm your
entries are there, then visit the same URL in Safari. **If Safari shows the
first-run screen, storage is partitioned** and the URL route reaches only the
Safari copy. The fallback is to have the Shortcut copy the amount to the
clipboard and use *Open App*, pasting it in the sheet — one more tap, but it
reaches the right storage.

## Where the data lives

In IndexedDB on the device, with `localStorage` as a fallback for private windows.
It is never transmitted. That also means it is exactly as durable as the browser
profile holding it: clear site data and it is gone.

So export regularly. Setup offers three:

| Export | Contents |
| --- | --- |
| Entries as CSV | One row per entry, with the derived contribution — import into a sheet |
| Expenses as CSV | Every expense, with its category |
| Summary as CSV | Targets, pace and monthly figures — a second tab in the same sheet |
| Full backup as JSON | Everything, and the only format `Restore` accepts |

Setup shows how long it has been since the last one.

## Running it

There is no build step and there are no runtime dependencies — `public/` is the
whole site.

```sh
npm run dev     # serve public/ at http://localhost:8080
npm test        # all three suites below, in Chromium
npm run icons   # re-render the PNG icons from the vector mark
```

| Suite | Covers |
| --- | --- |
| `tools/smoke-test.mjs` | pace maths, the entry sheet, history, CSV bodies, persistence |
| `tools/expenses-test.mjs` | expenses, categories, the cap, and the quick-add URL |
| `tools/sw-freshness-test.mjs` | that a deploy actually reaches an installed app |

`tools/serve.mjs` holds the static server, the frozen clock and the reporter they
share.

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
