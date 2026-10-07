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

The list gets long, so **Edit** in the category field puts a × on the typed ones.
Removing a chip takes it off the picker and nothing else: the expenses already
filed under it keep their label, stay in the month total and stay in the
breakdown. The five fixed categories cannot be removed. Typing the same name
again under Other brings its chip back, and the confirmation offers an undo for
seven seconds. A removed category still appears on the picker while you are
editing an expense that wears it — otherwise saving that expense would quietly
change its category.

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
iOS will go: **a Shortcut cannot write into this app's storage.** It does not
need to. A `webapp://` link opens the installed app, and the app can open
straight onto the expense sheet with the keypad up — which is the whole point of
the gesture.

If the link will also carry the amount, the typing disappears too; see below for
why that part is worth testing rather than assuming.

### The Shortcut

`webapp://` opens an installed home-screen web app. **The URL has to match the
installed one exactly, trailing slash included**, and getting it wrong does not
fail cleanly — on a phone with several web apps installed, a near-miss has been
observed opening a different one.

Setup carries a **Copy this app's link** row that reports the exact string for the
running app. Use that rather than retyping.

```
webapp://fintracktor.netlify.app/
```

1. **Shortcuts** → **+**
2. Add a **URL** action and paste the link
3. Add **Open URLs**
4. Rename it *Log expense*

Then **Settings → Accessibility → Touch → Back Tap → Double Tap** and pick it.

Finally, in Fintracktor: **Setup → Open the keypad on launch**. The app then opens
straight into a new expense. Back tap, type the amount, pick a category, save.

**Do not append anything to that URL.** Adding `#spend` to it has been observed to
stop it working on iOS: the match is strict enough that even a fragment breaks it.
That is why the keypad is a setting rather than a URL parameter — the app cannot
be told anything through a `webapp://` link beyond "open".

### Carrying the amount in, in a browser

In a browser tab, where ordinary URLs apply, the app does read the figure from the
URL, in either the query or the hash:

```
https://fintracktor.netlify.app/?spend=250&cat=food&note=lunch
https://fintracktor.netlify.app/#spend=250&cat=food&note=lunch
```

`spend` is required; `cat` and `note` are optional, and an unknown `cat` becomes a
typed category. Both forms are stripped with `replaceState` *before* anything is
saved, so a refresh can never log the same expense twice, and the confirmation
toast carries an **Undo** for seven seconds. A hash arriving while the app is
already open is handled too, since changing only the fragment does not reload the
page.

This is the route to use if you run Fintracktor in Safari rather than from the
home screen. Note that the two are separate storage: moving between them means
exporting a JSON backup from one and restoring it in the other.

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
