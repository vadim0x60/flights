// Date picker: one calendar for departures and returns. Both are sets of days
// you toggle (no ranges, so you can pick four Fridays without searching the
// days between). A round trip searches every departure/return pair where the
// return is on or after the departure and, if you set one, the stay fits the
// min–max nights range. Each pair is one billable search, hence the cap, which
// disables any day that would push the count over it.

export const MAX_SEARCHES = 12;

const DAY = 864e5;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const parse = (s) => Date.parse(`${s}T00:00:00Z`);
const addDays = (s, n) => iso(parse(s) + n * DAY);
const fmt = (s, opts) => new Date(parse(s)).toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts });
const short = (s) => fmt(s, { weekday: 'short', day: 'numeric', month: 'short' });
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const WEEKDAY_NAMES = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];

export function createDatePicker(group) {
  const now = new Date();
  const today = iso(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const firstMonth = today.slice(0, 7);
  const lastMonth = addDays(today, 330).slice(0, 7);

  const state = {
    round: true,
    departures: new Set(),
    returns: new Set(),
    stay: { min: null, max: null }, // nights; null means no limit
    step: 'depart',
    month: firstMonth, // first of the two months shown, as YYYY-MM
    open: false,
  };

  const departTrigger = group.querySelector('[data-step="depart"]');
  const returnTrigger = group.querySelector('[data-step="return"]');
  const panel = group.querySelector('.date-picker');
  // The stay inputs are built once and never re-rendered, so typing keeps focus.
  panel.innerHTML = `
    <div class="cal-top"></div>
    <div class="cal-nav"></div>
    <div class="cal-months"></div>
    <div class="cal-foot">
      <div class="stay" role="group" aria-label="Length of stay">
        <span>Stay</span>
        <input type="number" data-stay="min" min="0" max="330" placeholder="any" aria-label="Minimum nights">
        <span>–</span>
        <input type="number" data-stay="max" min="0" max="330" placeholder="any" aria-label="Maximum nights">
        <span>nights</span>
      </div>
      <p class="cal-hint"></p>
      <div class="cal-actions"></div>
    </div>`;
  const part = (sel) => panel.querySelector(sel);

  const sorted = (set) => [...set].sort();
  const earliest = () => sorted(state.departures)[0];
  const current = () => (state.step === 'depart' ? state.departures : state.returns);
  const fitsStay = (dep, ret) => {
    const nights = (parse(ret) - parse(dep)) / DAY;
    return nights >= (state.stay.min ?? 0) && nights <= (state.stay.max ?? Infinity);
  };

  // The searches for the given sets: every valid pair, or each departure one way.
  const pairs = (deps = state.departures, rets = state.returns) => {
    if (!state.round) return sorted(deps).map((departure_date) => ({ departure_date }));
    return sorted(deps).flatMap((departure_date) => sorted(rets)
      .filter((return_date) => fitsStay(departure_date, return_date))
      .map((return_date) => ({ departure_date, return_date })));
  };
  // How many searches there would be with `day` added to the current step's set.
  const countWith = (day) => {
    const deps = new Set(state.departures);
    const rets = new Set(state.returns);
    (state.step === 'depart' ? deps : rets).add(day);
    return pairs(deps, rets).length;
  };
  // Returns before every departure can't pair with anything, so drop them.
  const prune = () => {
    for (const r of state.returns) if (!state.departures.size || r < earliest()) state.returns.delete(r);
  };

  // --- Rendering ------------------------------------------------------------

  const summary = (days) => (days.length === 1 ? short(days[0]) : `${short(days[0])} +${days.length - 1}`);

  function triggers() {
    const deps = sorted(state.departures);
    const rets = sorted(state.returns);
    const d = departTrigger.querySelector('b');
    d.textContent = deps.length ? summary(deps) : 'Pick dates';
    d.classList.toggle('is-empty', !deps.length);

    const r = returnTrigger.querySelector('b');
    r.classList.toggle('is-empty', !state.round || !rets.length);
    r.textContent = !state.round ? 'One way' : rets.length ? summary(rets) : 'Add return';
    for (const t of [departTrigger, returnTrigger]) t.setAttribute('aria-expanded', state.open);
    departTrigger.classList.toggle('is-active', state.open && state.step === 'depart');
    returnTrigger.classList.toggle('is-active', state.open && state.step === 'return');
  }

  function monthHtml(ym, paired) {
    const start = parse(`${ym}-01`);
    const offset = (new Date(start).getUTCDay() + 6) % 7; // Monday first
    const days = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
    const cells = [];
    for (let i = 0; i < offset; i++) cells.push('<span class="cal-blank"></span>');
    for (let n = 1; n <= days; n++) {
      const day = `${ym}-${String(n).padStart(2, '0')}`;
      const isDep = state.departures.has(day);
      const isRet = state.round && state.returns.has(day);
      const disabled = day < today
        || (state.step === 'return' && day < earliest())
        || (!current().has(day) && countWith(day) > MAX_SEARCHES);
      const cls = ['cal-day', isDep && 'is-dep', isRet && 'is-ret', day === today && 'is-today',
        (isDep || isRet) && !paired.has(day) && 'is-unpaired'].filter(Boolean).join(' ');
      const label = fmt(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
        + (isDep ? ', departure' : '') + (isRet ? ', return' : '')
        + ((isDep || isRet) && !paired.has(day) ? ', not in any search' : '');
      cells.push(`<button type="button" class="${cls}" data-day="${day}" ${disabled ? 'disabled' : ''}
        aria-pressed="${current().has(day)}" aria-label="${label}">${n}</button>`);
    }
    const heads = WEEKDAYS.map((w, i) => `<button type="button" class="cal-wd" data-weekday="${i}" data-month="${ym}"
      title="Toggle all ${WEEKDAY_NAMES[i]} in ${fmt(`${ym}-01`, { month: 'long' })}">${w}</button>`).join('');
    return `<div class="cal-month">
      <div class="cal-title">${fmt(`${ym}-01`, { month: 'long', year: 'numeric' })}</div>
      <div class="cal-grid">${heads}${cells.join('')}</div>
    </div>`;
  }

  function render() {
    triggers();
    panel.hidden = !state.open;
    if (!state.open) return;
    const list = pairs();
    const n = list.length;
    const paired = new Set(list.flatMap((p) => [p.departure_date, p.return_date]));
    const unpaired = [...state.departures, ...(state.round ? state.returns : [])].some((d) => !paired.has(d));
    const over = n > MAX_SEARCHES;
    const { min, max } = state.stay;
    const second = addDays(`${state.month}-28`, 7).slice(0, 7);

    part('.cal-top').innerHTML = `
      <div class="cal-seg" role="group" aria-label="Trip type">
        <button type="button" data-round="1" class="${state.round ? 'active' : ''}">Round trip</button>
        <button type="button" data-round="0" class="${state.round ? '' : 'active'}">One way</button>
      </div>
      ${state.round ? `<div class="cal-steps" role="tablist">
        <button type="button" role="tab" data-goto="depart" aria-selected="${state.step === 'depart'}">1 · Departures</button>
        <button type="button" role="tab" data-goto="return" aria-selected="${state.step === 'return'}" ${state.departures.size ? '' : 'disabled'}>2 · Returns</button>
      </div>` : ''}`;
    part('.cal-nav').innerHTML = `
      <button type="button" data-month-step="-1" aria-label="Previous month" ${state.month <= firstMonth ? 'disabled' : ''}>‹</button>
      <button type="button" data-month-step="1" aria-label="Next month" ${second >= lastMonth ? 'disabled' : ''}>›</button>`;
    part('.cal-months').innerHTML = monthHtml(state.month, paired) + monthHtml(second, paired);
    part('.stay').hidden = !state.round;

    const what = state.step === 'depart' ? 'departure' : 'return';
    part('.cal-hint').textContent =
      over ? `${n} searches is over the limit of ${MAX_SEARCHES}. Remove some days or narrow the stay.`
      : min !== null && max !== null && min > max ? 'The minimum stay is longer than the maximum, so nothing matches.'
      : n >= MAX_SEARCHES ? `That's the limit: ${MAX_SEARCHES} searches. Remove a day to add another.`
      : state.round && unpaired ? 'Faded days have no matching departure or return within the stay, so they aren\'t searched.'
      : `Click days to add or remove ${what} options. Click a weekday to toggle all of them in that month.`
        + (state.round ? ' Every departure is searched with every return that fits the stay.' : '');
    part('.cal-hint').classList.toggle('is-warning', over);

    const needsReturn = state.round && !state.returns.size;
    const primary = state.step === 'depart' && needsReturn
      ? `<button type="button" class="cal-primary" data-action="next" ${state.departures.size ? '' : 'disabled'}>Next: return →</button>`
      : `<button type="button" class="cal-primary" data-action="done" ${n && !over ? '' : 'disabled'}>Done</button>`;
    const skipped = state.departures.size * state.returns.size - n;
    const breakdown = state.round && state.returns.size
      ? ` (${state.departures.size} out × ${state.returns.size} back${skipped ? `, ${skipped} skipped` : ''})`
      : '';
    part('.cal-actions').innerHTML = `
      <span class="cal-count${over ? ' is-warning' : ''}">${n} of ${MAX_SEARCHES} searches${breakdown}</span>
      <button type="button" class="cal-clear" data-action="clear" ${current().size ? '' : 'disabled'}>Clear ${state.step === 'depart' ? 'departures' : 'returns'}</button>
      ${primary}`;
  }

  // --- Interaction -----------------------------------------------------------

  function open(step) {
    if (step === 'return') state.round = true;
    state.step = step === 'return' && state.departures.size ? 'return' : 'depart';
    state.open = true;
    render();
  }
  function close() {
    state.open = false;
    render();
  }

  const selectable = (day) => day >= today && (state.step === 'depart' || day >= earliest());

  function toggleWeekday(ym, wd) {
    const days = [];
    for (let t = parse(`${ym}-01`); iso(t).startsWith(ym); t += DAY) {
      if ((new Date(t).getUTCDay() + 6) % 7 === wd && selectable(iso(t))) days.push(iso(t));
    }
    const set = current();
    if (days.every((d) => set.has(d))) days.forEach((d) => set.delete(d));
    else for (const d of days) if (!set.has(d) && countWith(d) <= MAX_SEARCHES) set.add(d);
  }

  departTrigger.addEventListener('click', () => (state.open && state.step === 'depart' ? close() : open('depart')));
  returnTrigger.addEventListener('click', () => (state.open && state.step === 'return' ? close() : open('return')));

  panel.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || t.disabled) return;
    const { day, weekday, round, goto, monthStep, action } = t.dataset;
    if (day) {
      const set = current();
      if (!set.delete(day)) set.add(day);
    } else if (weekday) toggleWeekday(t.dataset.month, +weekday);
    else if (round) {
      state.round = round === '1';
      state.step = 'depart';
    } else if (goto) state.step = goto;
    else if (monthStep) state.month = addDays(`${state.month}-15`, 30 * monthStep).slice(0, 7);
    else if (action === 'next') state.step = 'return';
    else if (action === 'clear') current().clear();
    else if (action === 'done') return close();
    prune();
    if (!state.departures.size) state.step = 'depart';
    render();
  });

  panel.addEventListener('input', (e) => {
    const which = e.target.dataset.stay;
    if (!which) return;
    const v = e.target.value.trim();
    state.stay[which] = v === '' ? null : Math.max(0, Math.floor(Number(v)));
    render();
  });

  document.addEventListener('pointerdown', (e) => {
    if (state.open && !group.contains(e.target)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (state.open && e.key === 'Escape') close();
  });

  render();

  return {
    // The searches to run, or null after opening the picker where something is missing.
    trips() {
      if (!state.departures.size) { open('depart'); return null; }
      if (state.round && !state.returns.size) { open('return'); return null; }
      const list = pairs();
      if (!list.length || list.length > MAX_SEARCHES) { open(state.step); return null; }
      return list;
    },
  };
}
