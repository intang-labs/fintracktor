/* Fintracktor — savings and investment pace, kept on one device.
   "invested" is money contributed, never market value: see README. */
'use strict';

/* ── storage ────────────────────────────────────────────────────────────
   IndexedDB holds one document. localStorage is the fallback for private
   windows and browsers that refuse IDB, so the app still works there. */
const DB = 'fintracktor', STORE = 'state', KEY = 'doc', LS = 'fintracktor:doc';

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function readDoc() {
  try {
    const db = await openDB();
    return await new Promise((res, rej) => {
      const q = db.transaction(STORE).objectStore(STORE).get(KEY);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
  } catch {
    try { return JSON.parse(localStorage.getItem(LS) || 'null'); } catch { return null; }
  }
}
async function writeDoc(doc) {
  const plain = JSON.parse(JSON.stringify(doc));
  try {
    const db = await openDB();
    await new Promise((res, rej) => {
      const t = db.transaction(STORE, 'readwrite');
      t.objectStore(STORE).put(plain, KEY);
      t.oncomplete = res;
      t.onerror = () => rej(t.error);
    });
  } catch {
    try { localStorage.setItem(LS, JSON.stringify(plain)); }
    catch { toast('Could not save — this browser is blocking storage.'); }
  }
}

/* ── state ─────────────────────────────────────────────────────────────── */
const blank = () => ({
  v: 1,
  entries: [],
  targets: { savings: { amount: 0, month: '' }, invested: { amount: 0, month: '' } },
  currency: 'INR',
  lastExport: null,
});
let state = blank();
const save = () => writeDoc(state);

/* ── formatting ────────────────────────────────────────────────────────── */
const SYM = { INR: '₹', USD: '$', EUR: '€', GBP: '£' };
const localeFor = c => (c === 'INR' ? 'en-IN' : c === 'GBP' ? 'en-GB' : c === 'EUR' ? 'de-DE' : 'en-US');
const group = n => new Intl.NumberFormat(localeFor(state.currency)).format(n);

function money(n) {
  const neg = n < 0;
  return (neg ? '−' : '') + (SYM[state.currency] || '₹') + group(Math.round(Math.abs(n)));
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ── dates ─────────────────────────────────────────────────────────────── */
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayISO = () => iso(new Date());
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const monthIdx = ym => { const [y, m] = ym.split('-').map(Number); return y * 12 + (m - 1); };
const nowMonthIdx = () => { const d = new Date(); return d.getFullYear() * 12 + d.getMonth(); };
const thisMonth = () => todayISO().slice(0, 7);
const days = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);

const fmtDay = s => parseISO(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const fmtShort = s => parseISO(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const fmtMonth = ym => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1)
  .toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

function endOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ── the maths ─────────────────────────────────────────────────────────── */
const sorted = () => [...state.entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

/* Average change per month across the last few gaps, so irregular logging
   still gives a fair rate. */
function trailingAvg(list, key) {
  if (list.length < 2) return null;
  const slice = list.slice(-4);
  let delta = 0, months = 0;
  for (let i = 1; i < slice.length; i++) {
    delta += slice[i][key] - slice[i - 1][key];
    months += Math.max(0.25, days(slice[i - 1].date, slice[i].date) / 30.44);
  }
  return months > 0 ? delta / months : null;
}

/* The month-end figure is anchored to where the month STARTED, not to the
   latest entry — otherwise the goalpost would shift every time you log. */
function track(list, key) {
  const t = state.targets[key];
  const amount = Number(t.amount) || 0;
  const current = list.length ? list.at(-1)[key] : 0;
  const monthsLeft = t.month ? monthIdx(t.month) - nowMonthIdx() + 1 : null;

  const before = list.filter(e => e.date.slice(0, 7) < thisMonth());
  const baseline = before.length ? before.at(-1)[key] : (list.length ? list[0][key] : 0);

  const live = amount > 0 && monthsLeft !== null && monthsLeft > 0;
  const perMonth = live ? Math.max(0, (amount - baseline) / monthsLeft) : null;
  const monthEnd = perMonth === null ? null : baseline + perMonth;
  const avg = trailingAvg(list, key);

  let status = 'none';
  if (amount > 0) {
    if (current >= amount) status = 'reached';
    else if (monthsLeft !== null && monthsLeft <= 0) status = 'overdue';
    else if (!t.month) status = 'nodate';
    else if (avg === null) status = 'new';
    else status = avg >= perMonth ? 'onpace' : 'behind';
  }

  const gap = perMonth || 0;
  return {
    key, amount, current, monthsLeft, baseline, perMonth, monthEnd, avg, status,
    pct: amount > 0 ? clamp(current / amount, 0, 1) : 0,
    monthPct: gap > 0 ? clamp((current - baseline) / gap, 0, 1) : 1,
    toGo: monthEnd === null ? 0 : Math.max(0, monthEnd - current),
  };
}

const CHIP = {
  reached: ['ok', 'Reached'], onpace: ['ok', 'On pace'], behind: ['bad', 'Behind'],
  overdue: ['bad', 'Date passed'], new: ['flat', 'Just started'], nodate: ['flat', 'No date'],
  none: ['flat', 'No target'],
};

/* ── render: pace ──────────────────────────────────────────────────────── */
let range = '1Y';

function renderPace() {
  const el = document.getElementById('tab-pace');
  const list = sorted();

  if (!list.length) { el.innerHTML = firstRun(); return; }

  const s = track(list, 'savings'), i = track(list, 'invested');
  const last = list.at(-1), prev = list.at(-2);
  const total = last.savings + last.invested;
  const targetSum = s.amount + i.amount;

  let hero = `<div class="card hero">
    <div class="eyebrow">Savings + invested</div>
    <span class="num total">${money(total)}</span>`;
  if (prev) {
    const d = total - (prev.savings + prev.invested);
    hero += `<div class="delta ${d >= 0 ? 'up' : 'down'}">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"
        stroke-linecap="round" stroke-linejoin="round">${d >= 0
          ? '<path d="M12 19V6"/><path d="M6 12l6-6 6 6"/>'
          : '<path d="M12 5v13"/><path d="M6 12l6 6 6-6"/>'}</svg>
      <span class="num">${money(Math.abs(d))}</span>
      <span class="when">since ${esc(fmtShort(prev.date))}</span></div>`;
  } else {
    hero += `<div class="delta up"><span class="when">First entry logged</span></div>`;
  }
  if (targetSum > 0) {
    const ps = clamp(last.savings / targetSum, 0, 1) * 100;
    const pi = clamp(last.invested / targetSum, 0, 1) * 100;
    const next = [s, i].filter(t => t.monthsLeft !== null && t.monthsLeft > 0)
      .sort((a, b) => a.monthsLeft - b.monthsLeft)[0];
    hero += `<div class="split">
        <span style="width:${ps.toFixed(1)}%;background:var(--save)"></span>
        <span style="width:${pi.toFixed(1)}%;background:var(--invest)"></span>
      </div>
      <div class="foot">
        <span><b>${Math.round(clamp(total / targetSum, 0, 1) * 100)}%</b> of ${money(targetSum)}</span>
        ${next ? `<span class="num">NEXT TARGET ${esc(fmtMonth(state.targets[next.key].month).toUpperCase())}</span>` : ''}
      </div>`;
  }
  hero += `</div>`;

  el.innerHTML = hero + monthCard(s, i) + trackCard(s, 'Savings', 'save')
    + trackCard(i, 'Invested', 'invest') + chartCard(list);

  el.querySelectorAll('.seg button').forEach(b => b.onclick = () => { range = b.dataset.r; renderPace(); });
}

function firstRun() {
  const hasTargets = state.targets.savings.amount > 0 || state.targets.invested.amount > 0;
  return `<div class="card hero">
      <div class="eyebrow">Savings + invested</div>
      <span class="num total" style="color:#C7CDD6">${money(0)}</span>
      <div class="split" style="margin-top:14px"></div>
      <div class="foot"><span>${hasTargets ? 'Log where you stand to begin' : 'No target yet'}</span></div>
    </div>
    <div class="steps" style="padding:6px 6px 14px">
      <h2>Two steps and this fills itself in.</h2>
      <p>About a minute now, ten seconds each time after.</p>
    </div>
    <div class="card">
      <div class="step ${hasTargets ? 'later' : ''}">
        <span class="n">1</span>
        <span><b>Set your two targets</b>
          <small>How much you want saved, how much invested, and the month you want each by.</small></span>
      </div>
      ${hasTargets ? '' : `<button class="primary" id="goSetup" style="margin-top:14px">Set targets</button>`}
    </div>
    <div class="card">
      <div class="step ${hasTargets ? '' : 'later'}">
        <span class="n">2</span>
        <span><b>Log where you stand</b>
          <small>Tap <b>+</b> and enter your bank balance and the total you have put into investments.</small></span>
      </div>
    </div>
    <p class="privacy">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.9"
        stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="10" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
      <span>No sign-up and no server. Your figures are written to this device and stay there.</span>
    </p>`;
}

function monthCard(s, i) {
  if (s.monthEnd === null && i.monthEnd === null) {
    return `<div class="card">
      <div class="eyebrow">This month</div>
      <p style="font-size:14px;color:var(--muted);margin:10px 0 0;line-height:1.5">
        Set a target and a month in <b>Setup</b> and this becomes a figure to hit by the end of
        ${esc(endOfMonth().toLocaleDateString(undefined, { month: 'long' }))}.</p></div>`;
  }
  const left = Math.max(0, days(todayISO(), iso(endOfMonth())));
  const eom = endOfMonth().toLocaleDateString(undefined, { day: 'numeric', month: 'long' });

  const lead = s.monthEnd !== null ? s : i;
  const other = lead === s ? i : s;
  const leadName = lead.key === 'savings' ? 'Savings' : 'Invested';

  let html = `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
      <span class="eyebrow">${leadName} by ${esc(eom)}</span>
      <span class="chip ${left <= 7 ? 'warn' : 'flat'}">${left === 0 ? 'Last day' : left + ' days left'}</span>
    </div>
    <div style="display:flex;align-items:baseline;gap:9px;margin-top:11px">
      <span class="num month-target">${money(lead.monthEnd)}</span>
      <span style="font-size:12px;color:var(--muted)">to stay on pace</span>
    </div>
    <div class="bart" style="height:12px"><span class="barf"
      style="width:${(lead.monthPct * 100).toFixed(1)}%;background:var(--${lead.key === 'savings' ? 'save' : 'invest'})"></span></div>
    <div class="foot" style="margin-top:9px">
      <span>You are at <b>${money(lead.current)}</b></span>
      <span class="num" style="color:var(--save);font-weight:600">${lead.toGo > 0
        ? money(lead.toGo).toUpperCase() + ' TO GO' : 'DONE'}</span>
    </div>`;

  if (other.monthEnd !== null) {
    const done = other.toGo <= 0;
    const name = other.key === 'savings' ? 'Savings' : 'Investments';
    html += `<div class="month-done ${done ? '' : 'warn'}">
      ${done
        ? `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--save)" stroke-width="2.4"
             stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`
        : `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--invest)" stroke-width="2.2"
             stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`}
      <span style="flex:1">${done
        ? `${name} done — <span class="num" style="font-weight:600">${money(other.current - other.baseline)}</span> added this month.`
        : `${name} needs <span class="num" style="font-weight:600">${money(other.toGo)}</span> more by ${esc(eom)}.`}</span>
    </div>`;
  }
  return html + `</div>`;
}

function trackCard(t, name, hue) {
  const [cls, label] = CHIP[t.status];
  const ym = state.targets[t.key].month;
  let foot = '';
  if (t.amount > 0 && t.perMonth !== null) {
    foot = `<span>Needs <b>${money(t.perMonth)}</b>/mo${t.avg !== null
      ? ` · ${t.key === 'savings' ? 'at' : 'adding'} <b>${money(t.avg)}</b>` : ''}</span>
      <span class="num" style="font-size:11px">${esc(fmtMonth(ym).toUpperCase())}</span>`;
  } else if (t.amount > 0 && t.status === 'reached') {
    foot = `<span>Target met — <b>${money(t.current - t.amount)}</b> beyond it</span>`;
  } else if (t.amount > 0 && t.status === 'overdue') {
    foot = `<span><b>${money(t.amount - t.current)}</b> short when the date passed</span>
      <span class="num" style="font-size:11px">${esc(fmtMonth(ym).toUpperCase())}</span>`;
  } else {
    foot = `<span>Set a target in Setup to track pace</span>`;
  }
  return `<div class="card">
    <div class="track-head">
      <span class="dot" style="background:var(--${hue})"></span>
      <span class="name">${name}</span>
      <span class="chip ${cls}">${label}</span>
    </div>
    <div class="track-now">
      <span class="num big">${money(t.current)}</span>
      ${t.amount > 0 ? `<span class="num of">of ${money(t.amount)}</span>` : ''}
    </div>
    <div class="bart"><span class="barf" style="width:${(t.pct * 100).toFixed(1)}%;background:var(--${hue})"></span></div>
    <div class="foot">${foot}</div>
    ${t.key === 'invested'
      ? `<div class="note">Counts what you have put in. What it is worth today is deliberately left out.</div>`
      : ''}
  </div>`;
}

function chartCard(all) {
  const cut = { '6M': 6, '1Y': 12, ALL: 0 }[range];
  const list = cut
    ? all.filter(e => monthIdx(e.date.slice(0, 7)) > nowMonthIdx() - cut)
    : all;
  const seg = ['6M', '1Y', 'ALL'].map(r =>
    `<button data-r="${r}" aria-pressed="${r === range}">${r}</button>`).join('');

  let body;
  if (list.length < 2) {
    body = `<p class="empty">Two entries in this range and the trend appears here.</p>`;
  } else {
    const W = 330, H = 150, L = 18, R = 18, T = 14, B = 28;
    const totals = list.map(e => e.savings + e.invested);
    const hi = Math.max(...totals, 1) * 1.08;
    const x = n => L + n * (W - L - R) / (list.length - 1);
    const y = v => (H - B) - (v / hi) * ((H - B) - T);
    const sp = list.map((e, n) => `${x(n).toFixed(1)},${y(e.savings).toFixed(1)}`).join(' ');
    const tp = list.map((e, n) => `${x(n).toFixed(1)},${y(e.savings + e.invested).toFixed(1)}`).join(' ');
    const revS = list.map((e, n) => `${x(n).toFixed(1)},${y(e.savings).toFixed(1)}`).reverse().join(' ');
    body = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"
        aria-label="Savings and money invested over time">
      <defs>
        <linearGradient id="gi" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#C97A16" stop-opacity=".26"/>
          <stop offset="100%" stop-color="#C97A16" stop-opacity=".06"/></linearGradient>
        <linearGradient id="gs" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#0F8A7E" stop-opacity=".30"/>
          <stop offset="100%" stop-color="#0F8A7E" stop-opacity=".08"/></linearGradient>
      </defs>
      <polygon points="${tp} ${revS}" fill="url(#gi)"/>
      <polygon points="${L},${H - B} ${sp} ${x(list.length - 1)},${H - B}" fill="url(#gs)"/>
      <polyline points="${tp}" fill="none" stroke="#C97A16" stroke-width="2.4"
        stroke-linejoin="round" stroke-linecap="round"/>
      <polyline points="${sp}" fill="none" stroke="#0F8A7E" stroke-width="2.4"
        stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${x(list.length - 1)}" cy="${y(totals.at(-1))}" r="4" fill="#C97A16" stroke="#fff" stroke-width="2"/>
      <circle cx="${x(list.length - 1)}" cy="${y(list.at(-1).savings)}" r="4" fill="#0F8A7E" stroke="#fff" stroke-width="2"/>
    </svg>
    <div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:10px;color:var(--faint)">
      <span>${esc(fmtShort(list[0].date))}</span><span>${esc(fmtShort(list.at(-1).date))}</span>
    </div>`;
  }
  return `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span class="eyebrow">Trend</span><span class="seg">${seg}</span>
    </div>
    ${body}
    <div class="legend">
      <span><i style="background:var(--save)"></i>Savings</span>
      <span><i style="background:var(--invest)"></i>Invested</span>
    </div></div>`;
}

/* ── render: history ───────────────────────────────────────────────────── */
function renderHistory() {
  const el = document.getElementById('tab-history');
  const list = sorted().reverse();
  if (!list.length) {
    el.innerHTML = `<h1 class="page-title">History</h1>
      <div class="card"><p class="empty">Nothing logged yet. Tap <b>+</b> to start.</p></div>`;
    return;
  }
  el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:baseline;margin:0 4px 14px">
      <h1 class="page-title" style="margin:0">History</h1>
      <span class="eyebrow">${list.length} ${list.length === 1 ? 'entry' : 'entries'}</span>
    </div>` + list.map((e, n) => {
    const next = list[n + 1];
    const added = next ? e.invested - next.invested : null;
    return `<div class="swipe" data-id="${esc(e.id)}">
      <button class="del" data-del="${esc(e.id)}" aria-label="Delete entry from ${esc(fmtDay(e.date))}">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9"
          stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13"/></svg>
        Delete
      </button>
      <button class="face" data-edit="${esc(e.id)}">
        <span class="entry-top">
          <span class="eyebrow">${esc(fmtDay(e.date))}</span>
          ${added !== null && added !== 0
            ? `<span class="chip ${added > 0 ? 'warn' : 'bad'}">${added > 0 ? '+' : '−'}${money(Math.abs(added))}</span>`
            : `<span class="chip flat">${next ? 'nothing added' : 'first entry'}</span>`}
        </span>
        <span class="num entry-total" style="display:block">${money(e.savings + e.invested)}</span>
        <span class="entry-legs">
          <span><i style="background:var(--save)"></i><span class="num">${money(e.savings)}</span></span>
          <span><i style="background:var(--invest)"></i><span class="num">${money(e.invested)}</span></span>
        </span>
        ${e.note ? `<span class="entry-note">${esc(e.note)}</span>` : ''}
      </button>
    </div>`;
  }).join('');

  el.querySelectorAll('[data-del]').forEach(b => b.onclick = async ev => {
    ev.stopPropagation();
    const e = state.entries.find(x => x.id === b.dataset.del);
    if (!confirm(`Delete the entry from ${fmtDay(e.date)}?`)) return;
    state.entries = state.entries.filter(x => x.id !== b.dataset.del);
    await save(); renderAll();
  });
  el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
    const row = b.closest('.swipe');
    if (row.classList.contains('open')) { row.classList.remove('open'); return; }
    openSheet(b.dataset.edit);
  });
  attachSwipe(el);
}

/* Drag a row left to uncover Delete. Pointer events so it works with a
   mouse too, which is also how it gets tested. */
function attachSwipe(root) {
  root.querySelectorAll('.swipe').forEach(row => {
    const face = row.querySelector('.face');
    let x0 = null, moved = false;
    face.addEventListener('pointerdown', e => { x0 = e.clientX; moved = false; });
    face.addEventListener('pointermove', e => {
      if (x0 === null) return;
      const dx = e.clientX - x0;
      if (Math.abs(dx) > 8) moved = true;
      if (dx < -44) {
        root.querySelectorAll('.swipe.open').forEach(o => o !== row && o.classList.remove('open'));
        row.classList.add('open');
      } else if (dx > 20) row.classList.remove('open');
    });
    face.addEventListener('pointerup', () => { if (moved) setTimeout(() => (x0 = null), 0); else x0 = null; });
    face.addEventListener('click', e => { if (moved) { e.preventDefault(); e.stopImmediatePropagation(); moved = false; } }, true);
  });
}

/* ── render: setup ─────────────────────────────────────────────────────── */
function renderSetup() {
  const list = sorted();
  for (const key of ['savings', 'invested']) {
    const t = state.targets[key], k = key === 'savings' ? 'Save' : 'Inv';
    const amt = document.getElementById(`t${k}Amt`), mon = document.getElementById(`t${k}Month`);
    if (document.activeElement !== amt) amt.value = t.amount ? group(t.amount) : '';
    if (document.activeElement !== mon) mon.value = t.month || '';

    const d = track(list, key), note = document.getElementById(`${key === 'savings' ? 'save' : 'inv'}TargetNote`);
    if (!t.amount) note.textContent = 'No target set yet.';
    else if (!t.month) note.textContent = 'Add a month and this becomes a monthly figure.';
    else if (d.status === 'reached') note.textContent = 'Target reached.';
    else if (d.monthsLeft <= 0) note.textContent = `That month has passed — ${money(t.amount - d.current)} short.`;
    else note.innerHTML = `<span class="num" style="font-weight:600">${money(t.amount - d.baseline)}</span>
      to go over ${d.monthsLeft} month${d.monthsLeft === 1 ? '' : 's'} —
      <span class="num" style="font-weight:600">${money(d.perMonth)}</span> a month${
      key === 'invested' ? ' of your own money' : ''}.`;
  }
  document.getElementById('tCur').value = state.currency;

  const age = document.getElementById('exportAge');
  if (!state.lastExport) { age.textContent = ''; return; }
  const n = days(state.lastExport, todayISO());
  age.className = 'chip ' + (n >= 30 ? 'warn' : 'flat');
  age.textContent = n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
}

/* ── the sheet ─────────────────────────────────────────────────────────── */
const sheet = document.getElementById('sheet'), scrim = document.getElementById('scrim');
let editing = null, invMode = 'add';

function openSheet(id) {
  editing = id ? state.entries.find(e => e.id === id) : null;
  document.getElementById('sheetTitle').textContent = editing ? 'Edit entry' : 'New entry';
  document.getElementById('saveEntry').textContent = editing ? 'Save changes' : 'Save entry';
  const date = editing ? editing.date : todayISO();
  document.getElementById('fDate').value = date;
  document.getElementById('fSave').value = editing ? group(editing.savings) : '';
  document.getElementById('fInv').value = editing ? group(editing.invested) : '';
  document.getElementById('fNote').value = editing ? (editing.note || '') : '';

  // Contributions are how people think month to month, so a new entry defaults
  // to Add. Editing shows the stored total, since that is what is being fixed.
  invMode = editing || !sheetPrev(date) ? 'total' : 'add';
  syncDateLabel(); syncInvUI();

  sheet.hidden = false;
  requestAnimationFrame(() => { scrim.classList.add('on'); sheet.classList.add('on'); });
  setTimeout(() => document.getElementById('fSave').focus({ preventScroll: true }), 340);
}
function closeSheet() {
  scrim.classList.remove('on'); sheet.classList.remove('on');
  setTimeout(() => { sheet.hidden = true; editing = null; }, 320);
}

function syncDateLabel() {
  const v = document.getElementById('fDate').value || todayISO();
  document.getElementById('dateLabel').textContent =
    (v === todayISO() ? 'Today · ' : '') + fmtDay(v);
}
/* The entry immediately before this one, ignoring the entry being edited. */
function sheetPrev(date) {
  return sorted().filter(e => e.date < date && (!editing || e.id !== editing.id)).at(-1) || null;
}

/* Whichever way the figure is being entered, show the other one — so what
   actually gets stored is never a surprise. */
function syncInvUI() {
  const date = document.getElementById('fDate').value || todayISO();
  const prev = sheetPrev(date);
  const el = document.getElementById('fInv');
  const label = document.getElementById('invLabel');
  const hint = document.getElementById('invHint');
  const seg = document.getElementById('invMode');
  const typed = el.value.trim() !== '';
  const raw = readMoney('fInv');

  seg.hidden = !prev;
  seg.querySelectorAll('button').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.mode === invMode)));

  if (!prev) {
    label.textContent = 'Invested so far — everything to date';
    hint.textContent = '';
  } else if (invMode === 'add') {
    label.textContent = `Added to investments since ${fmtShort(prev.date)}`;
    hint.style.color = 'var(--save)';
    hint.textContent = typed
      ? `New total ${money(prev.invested + raw)}`
      : `Running total so far ${money(prev.invested)}`;
  } else {
    label.textContent = 'Invested — running total';
    const d = raw - prev.invested;
    hint.style.color = d < 0 ? 'var(--over)' : 'var(--save)';
    hint.textContent = typed
      ? `${d >= 0 ? '+' : '−'}${money(Math.abs(d))} since ${fmtShort(prev.date)}`
      : `Was ${money(prev.invested)} on ${fmtShort(prev.date)}`;
  }

  const sh = document.getElementById('saveHint');
  sh.textContent = prev ? `Last logged ${money(prev.savings)} on ${fmtShort(prev.date)}` : '';
}

/* Switching mode converts whatever is already typed, so the meaning of the
   number on screen never changes underneath the switch. */
document.getElementById('invMode').addEventListener('click', e => {
  const b = e.target.closest('button[data-mode]');
  if (!b || b.dataset.mode === invMode) return;
  const el = document.getElementById('fInv');
  const prev = sheetPrev(document.getElementById('fDate').value || todayISO());
  if (prev && el.value.trim()) {
    const raw = readMoney('fInv');
    el.value = invMode === 'add'
      ? group(prev.invested + raw)
      : group(Math.max(0, raw - prev.invested));
  }
  invMode = b.dataset.mode;
  syncInvUI();
});

document.getElementById('fab').onclick = () => openSheet(null);
document.getElementById('sheetClose').onclick = closeSheet;
scrim.onclick = closeSheet;
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });
document.getElementById('fDate').onchange = () => { syncDateLabel(); syncInvUI(); };
document.getElementById('fInv').addEventListener('input', syncInvUI);

document.getElementById('saveEntry').onclick = async () => {
  const date = document.getElementById('fDate').value || todayISO();
  const savings = readMoney('fSave'), rawInv = readMoney('fInv');
  if (!document.getElementById('fSave').value.trim() && !document.getElementById('fInv').value.trim()) {
    toast('Enter at least one figure.'); return;
  }
  const prev = sheetPrev(date);
  const invested = invMode === 'add' && prev ? prev.invested + rawInv : rawInv;

  // Entering a contribution into the Total field is the easy mistake to make,
  // and it reads as a large loss. Catch it before it is stored.
  if (prev && invested < prev.invested) {
    const ok = confirm(
      `This records your invested total falling from ${money(prev.invested)} to ${money(invested)}.\n\n`
      + `If you meant that you added ${money(rawInv)} this month, cancel and switch to Add.\n\n`
      + `Save the drop anyway?`);
    if (!ok) return;
  }
  const note = document.getElementById('fNote').value.trim();
  const clash = state.entries.find(e => e.date === date && (!editing || e.id !== editing.id));
  if (clash && !confirm(`There is already an entry for ${fmtDay(date)}. Replace it?`)) return;
  if (clash) state.entries = state.entries.filter(e => e.id !== clash.id);

  if (editing) Object.assign(editing, { date, savings, invested, note });
  else state.entries.push({ id: crypto.randomUUID(), date, savings, invested, note });

  await save();
  closeSheet(); renderAll(); go('pace');
  toast(editing ? 'Entry updated.' : 'Entry saved.');
};

/* Drag the sheet down to dismiss. */
(() => {
  let y0 = null;
  const head = sheet.querySelector('.sheet-head'), grab = sheet.querySelector('.grab');
  [head, grab].forEach(el => {
    el.addEventListener('pointerdown', e => { y0 = e.clientY; sheet.style.transition = 'none'; });
  });
  addEventListener('pointermove', e => {
    if (y0 === null) return;
    const dy = Math.max(0, e.clientY - y0);
    sheet.style.transform = `translateY(${dy}px)`;
  });
  addEventListener('pointerup', e => {
    if (y0 === null) return;
    const dy = Math.max(0, e.clientY - y0);
    y0 = null; sheet.style.transition = ''; sheet.style.transform = '';
    if (dy > 110) closeSheet();
  });
})();

/* ── money inputs ──────────────────────────────────────────────────────── */
const readMoney = id => Number(document.getElementById(id).value.replace(/[^\d]/g, '')) || 0;

function attachMoney(input) {
  input.addEventListener('input', () => {
    const upto = input.value.slice(0, input.selectionStart ?? input.value.length);
    const digitsBefore = (upto.match(/\d/g) || []).length;
    const digits = input.value.replace(/[^\d]/g, '').slice(0, 15).replace(/^0+(?=\d)/, '');
    const out = digits ? group(Number(digits)) : '';
    input.value = out;
    let seen = 0, pos = 0;
    if (digitsBefore > 0) {
      pos = out.length;
      for (let n = 0; n < out.length; n++) {
        if (/\d/.test(out[n])) seen++;
        if (seen === digitsBefore) { pos = n + 1; break; }
      }
    }
    try { input.setSelectionRange(pos, pos); } catch {}
  });
}
['fSave', 'fInv', 'tSaveAmt', 'tInvAmt'].forEach(id => attachMoney(document.getElementById(id)));

/* ── setup wiring ──────────────────────────────────────────────────────── */
function bindTarget(inputId, key, field) {
  const el = document.getElementById(inputId);
  const commit = async () => {
    state.targets[key][field] = field === 'amount' ? readMoney(inputId) : el.value;
    await save(); renderSetup(); renderPace();
  };
  el.addEventListener('change', commit);
  el.addEventListener('blur', commit);
}
bindTarget('tSaveAmt', 'savings', 'amount');
bindTarget('tSaveMonth', 'savings', 'month');
bindTarget('tInvAmt', 'invested', 'amount');
bindTarget('tInvMonth', 'invested', 'month');

document.getElementById('tCur').onchange = async e => {
  state.currency = e.target.value; await save(); renderAll(); renderSetup();
};

/* ── export and restore ────────────────────────────────────────────────── */
function download(name, mime, text) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const cell = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
const csv = rows => rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
const stamp = () => todayISO();

async function markExported() { state.lastExport = todayISO(); await save(); renderSetup(); }

document.getElementById('btnCsvEntries').onclick = async () => {
  const list = sorted();
  if (!list.length) { toast('Nothing to export yet.'); return; }
  const rows = [['Date', 'Savings', 'Invested', 'Added', 'Total', 'Note']];
  list.forEach((e, n) => rows.push([
    e.date, e.savings, e.invested,
    n ? e.invested - list[n - 1].invested : '',
    e.savings + e.invested, e.note || '',
  ]));
  download(`fintracktor-entries-${stamp()}.csv`, 'text/csv;charset=utf-8', csv(rows));
  await markExported(); toast('Entries exported.');
};

document.getElementById('btnCsvSummary').onclick = async () => {
  const list = sorted();
  const s = track(list, 'savings'), i = track(list, 'invested');
  const rows = [['Item', 'Value']];
  rows.push(['Exported', todayISO()], ['Currency', state.currency], ['Entries', list.length]);
  if (list.length) rows.push(['Latest entry', list.at(-1).date]);
  for (const [name, t] of [['Savings', s], ['Invested', i]]) {
    rows.push([`${name} now`, t.current]);
    if (t.amount) rows.push([`${name} target`, t.amount], [`${name} target month`, state.targets[t.key].month || '']);
    if (t.perMonth !== null) rows.push([`${name} needed per month`, Math.round(t.perMonth)],
      [`${name} target for this month end`, Math.round(t.monthEnd)]);
    if (t.avg !== null) rows.push([`${name} recent average per month`, Math.round(t.avg)]);
    rows.push([`${name} status`, CHIP[t.status][1]]);
  }
  download(`fintracktor-summary-${stamp()}.csv`, 'text/csv;charset=utf-8', csv(rows));
  await markExported(); toast('Summary exported.');
};

document.getElementById('btnJson').onclick = async () => {
  download(`fintracktor-backup-${stamp()}.json`, 'application/json',
    JSON.stringify({ app: 'fintracktor', ...state }, null, 2));
  await markExported(); toast('Backup saved.');
};

document.getElementById('btnRestore').onclick = () => document.getElementById('fileIn').click();
document.getElementById('fileIn').onchange = async ev => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (!Array.isArray(d.entries)) throw new Error('shape');
    if (!confirm(`Replace everything here with ${d.entries.length} entries from this backup?`)) return;
    state = Object.assign(blank(), d);
    await save(); renderAll(); renderSetup(); go('pace');
    toast('Backup restored.');
  } catch {
    toast('That file is not a Fintracktor backup.');
  }
};

document.getElementById('btnWipe').onclick = async () => {
  if (!confirm('Erase every entry and target? Export a backup first if you want a copy.')) return;
  if (!confirm('Really erase everything? This cannot be undone.')) return;
  const cur = state.currency;
  state = blank(); state.currency = cur;
  await save(); renderAll(); renderSetup(); go('pace');
  toast('Everything erased.');
};

/* ── tabs, toast ───────────────────────────────────────────────────────── */
function go(tab) {
  document.querySelectorAll('nav button').forEach(b =>
    b.setAttribute('aria-current', String(b.dataset.tab === tab)));
  ['pace', 'history', 'setup'].forEach(n =>
    document.getElementById('tab-' + n).hidden = n !== tab);
  document.getElementById('fab').hidden = tab === 'setup';
  scrollTo(0, 0);
}
document.querySelectorAll('nav button').forEach(b => b.onclick = () => go(b.dataset.tab));
document.addEventListener('click', e => {
  if (e.target.closest('#goSetup')) go('setup');
});

let toastTimer;
function toast(msg, action, fn) {
  const box = document.getElementById('toast');
  box.querySelector('.msg').textContent = msg;
  const btn = box.querySelector('button');
  btn.hidden = !action;
  if (action) { btn.textContent = action; btn.onclick = () => { box.classList.remove('on'); fn(); }; }
  box.classList.add('on');
  clearTimeout(toastTimer);
  if (!action) toastTimer = setTimeout(() => box.classList.remove('on'), 3200);
}

function renderAll() {
  document.getElementById('stamp').textContent =
    (sorted().at(-1)?.date ? fmtShort(sorted().at(-1).date) : fmtShort(todayISO())).toUpperCase();
  renderPace(); renderHistory(); renderSetup();
}

/* ── service worker: offline, plus a prompt when a deploy lands ────────── */
if ('serviceWorker' in navigator) {
  // The first worker claims the page on install, which is not an update — only
  // reload when a worker replaces one that was already in charge.
  let hadWorker = !!navigator.serviceWorker.controller, reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadWorker) { hadWorker = true; return; }
    if (reloading) return; reloading = true; location.reload();
  });
  addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw?.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('A new version is ready.', 'Reload', () => sw.postMessage({ type: 'SKIP_WAITING' }));
          }
        });
      });
    } catch {}
  });
}

/* ── boot ──────────────────────────────────────────────────────────────── */
(async () => {
  const doc = await readDoc();
  if (doc) state = Object.assign(blank(), doc);
  renderAll();
  go('pace');
  try { await navigator.storage?.persist?.(); } catch {}
})();
