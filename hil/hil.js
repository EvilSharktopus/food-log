// Hil's Food Log — tap-to-log diary grouped by meal, with summary charts.
// Data lives in its own Firestore collections (hil_logs, hil_foods, hil_settings)
// so it never mixes with the main nutrition log.

const firebaseConfig = {
  apiKey: "AIzaSyBntACQyO30LiXg1oid74oewFsjvTu5PUQ",
  authDomain: "personal-214d2.firebaseapp.com",
  projectId: "personal-214d2",
  storageBucket: "personal-214d2.firebasestorage.app",
  messagingSenderId: "532101043328",
  appId: "1:532101043328:web:2144677c9ab750c3bd8265"
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

const LOGS = 'hil_logs';
const FOODS = 'hil_foods';
const SETTINGS = 'hil_settings';

const MEALS = {
  breakfast: { label: 'Breakfast', color: 'var(--s-breakfast)' },
  lunch:     { label: 'Lunch',     color: 'var(--s-lunch)' },
  dinner:    { label: 'Dinner',    color: 'var(--s-dinner)' },
  snack:     { label: 'Snack',     color: 'var(--s-snack)' }
};

// Colour themes. Values live in hil.css under [data-theme="..."]; this list
// drives the picker and the browser chrome colour.
const THEMES = [
  { id: 'warm',   label: 'Warm',   swatch: '#f97316', chrome: '#fdf6ec' },
  { id: 'clean',  label: 'Clean',  swatch: '#2563eb', chrome: '#f8fafc' },
  { id: 'sage',   label: 'Sage',   swatch: '#4d7c0f', chrome: '#f3f6ee' },
  { id: 'rose',   label: 'Rose',   swatch: '#db2777', chrome: '#fdf2f6' },
  { id: 'ocean',  label: 'Ocean',  swatch: '#0e7490', chrome: '#eef6f8' },
  { id: 'dark',   label: 'Dark',   swatch: '#f59e0b', chrome: '#15130f' }
];
const MEAL_ORDER = ['breakfast', 'lunch', 'dinner', 'snack'];

// Starter favourites, seeded once into hil_foods so they can be edited later.
const STARTER_FAVOURITES = [
  'Toast', 'Eggs', 'Oatmeal', 'Cereal', 'Yogurt', 'Banana', 'Apple',
  'Sandwich', 'Salad', 'Soup', 'Pasta', 'Rice', 'Chicken', 'Pizza',
  'Cheese & crackers', 'Cookies', 'Chips', 'Chocolate', 'Coffee', 'Tea', 'Smoothie'
];

// ---------- state ----------
let selectedDate = todayStr();
let dayEntries = [];            // entries for selectedDate
let foods = [];                 // library: {id, name, nameLower, favourite, useCount}
let allLogs = {};               // date -> entries[] (for summary)
let pickMeal = null;
let pickSelected = new Set();   // food ids
let summaryRange = '7';
let unsubDay = null;
let logsSubscribed = false;

// ---------- date helpers ----------
function pad(n) { return String(n).padStart(2, '0'); }
function fmt(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayStr() { return fmt(new Date()); }
function offsetDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return fmt(d);
}
function prettyDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}
function weekdayLabel(dateStr) {
  const t = todayStr();
  if (dateStr === t) return 'Today';
  if (dateStr === offsetDate(t, -1)) return 'Yesterday';
  if (dateStr === offsetDate(t, 1)) return 'Tomorrow';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long' });
}
function timeLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const views = { day: $('view-day'), pick: $('view-pick'), summary: $('view-summary') };

function showView(name) {
  Object.entries(views).forEach(([k, el]) => { el.style.display = k === name ? '' : 'none'; });
  window.scrollTo(0, 0);
}

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.style.display = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, 1800);
}

function showError(msg) {
  const el = $('error-banner');
  el.textContent = msg;
  el.style.display = '';
}
function clearError() { $('error-banner').style.display = 'none'; }

// ---------- init ----------
document.addEventListener('DOMContentLoaded', () => {
  wireEvents();
  initTheme();
  subscribeFoods();
  setDate(selectedDate);
});

// ---------- theme ----------
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'warm';
}

function applyTheme(id, { persist = true } = {}) {
  const theme = THEMES.find(t => t.id === id) || THEMES[0];
  document.documentElement.setAttribute('data-theme', theme.id);
  const meta = $('theme-color-meta');
  if (meta) meta.setAttribute('content', theme.chrome);
  document.querySelectorAll('.theme-swatch').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === theme.id);
    b.setAttribute('aria-checked', b.dataset.theme === theme.id ? 'true' : 'false');
  });
  if (!persist) return;
  try { localStorage.setItem('hil-theme', theme.id); } catch (_) {}
  db.collection(SETTINGS).doc('prefs').set({ theme: theme.id }, { merge: true }).catch(() => {});
}

function initTheme() {
  const row = $('theme-row');
  THEMES.forEach(t => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'theme-swatch';
    b.dataset.theme = t.id;
    b.setAttribute('role', 'radio');
    b.innerHTML = `<span class="theme-dot" style="background:${t.swatch}; border-color:${t.chrome}"></span><span class="theme-name">${t.label}</span>`;
    b.addEventListener('click', () => applyTheme(t.id));
    row.appendChild(b);
  });
  applyTheme(currentTheme(), { persist: false });
  // Follow the theme saved in Firestore so it matches across devices.
  db.collection(SETTINGS).doc('prefs').onSnapshot((doc) => {
    const saved = doc.exists && doc.data().theme;
    if (saved && saved !== currentTheme()) applyTheme(saved, { persist: false });
    if (saved) { try { localStorage.setItem('hil-theme', saved); } catch (_) {} }
  }, () => {});
}

function wireEvents() {
  $('prev-day').addEventListener('click', () => setDate(offsetDate(selectedDate, -1)));
  $('next-day').addEventListener('click', () => setDate(offsetDate(selectedDate, 1)));
  $('jump-today').addEventListener('click', () => setDate(todayStr()));
  $('date-label').addEventListener('click', () => {
    const inp = $('date-input');
    inp.value = selectedDate;
    if (typeof inp.showPicker === 'function') { try { inp.showPicker(); return; } catch (_) {} }
    inp.style.pointerEvents = 'auto';
    inp.focus(); inp.click();
  });
  $('date-input').addEventListener('change', (e) => { if (e.target.value) setDate(e.target.value); });

  document.querySelectorAll('.meal-tile').forEach(btn => {
    btn.addEventListener('click', () => openPicker(btn.dataset.meal));
  });

  $('open-summary').addEventListener('click', openSummary);
  $('summary-back').addEventListener('click', () => showView('day'));
  $('pick-back').addEventListener('click', () => showView('day'));

  $('food-search').addEventListener('input', renderPicker);
  $('food-search').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = $('food-search').value.trim();
    if (!q) return;
    const match = foods.find(f => f.nameLower === q.toLowerCase());
    if (match) { pickSelected.add(match.id); $('food-search').value = ''; renderPicker(); }
    else addNewFood(q);
  });
  $('add-new-btn').addEventListener('click', () => addNewFood($('food-search').value.trim()));
  $('log-selected').addEventListener('click', logSelected);

  document.querySelectorAll('.range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      summaryRange = btn.dataset.range;
      document.querySelectorAll('.range-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderSummary();
    });
  });
}

// ---------- day view ----------
function setDate(dateStr) {
  selectedDate = dateStr;
  $('date-weekday').textContent = weekdayLabel(dateStr);
  $('date-full').textContent = prettyDate(dateStr);
  $('jump-today').style.display = dateStr === todayStr() ? 'none' : '';

  if (unsubDay) unsubDay();
  dayEntries = [];
  renderDay();
  unsubDay = db.collection(LOGS).doc(dateStr).onSnapshot((doc) => {
    dayEntries = (doc.exists && Array.isArray(doc.data().entries)) ? doc.data().entries : [];
    renderDay();
  }, (err) => showError('Could not load this day: ' + err.message));
}

function renderDay() {
  const byMeal = {};
  MEAL_ORDER.forEach(m => byMeal[m] = []);
  dayEntries.forEach(e => { if (byMeal[e.meal]) byMeal[e.meal].push(e); });

  MEAL_ORDER.forEach(m => {
    const badge = document.querySelector(`.meal-count[data-count="${m}"]`);
    const n = byMeal[m].length;
    badge.textContent = n;
    badge.classList.toggle('on', n > 0);
  });

  const log = $('day-log');
  log.innerHTML = '';
  if (dayEntries.length === 0) {
    log.innerHTML = `<div class="log-empty">Nothing logged ${weekdayLabel(selectedDate).toLowerCase()} yet. Tap a meal above to start.</div>`;
    return;
  }

  MEAL_ORDER.forEach(m => {
    const items = byMeal[m];
    if (items.length === 0) return;
    const card = document.createElement('div');
    card.className = 'log-meal';
    card.innerHTML = `
      <div class="log-meal-head">
        <span>${MEALS[m].label}</span>
        <button class="log-meal-add" data-meal="${m}">＋ add more</button>
      </div>`;
    card.querySelector('.log-meal-add').addEventListener('click', () => openPicker(m));
    items
      .slice()
      .sort((a, b) => (a.at || '').localeCompare(b.at || ''))
      .forEach(e => {
        const row = document.createElement('div');
        row.className = 'log-item';
        row.innerHTML = `
          <span class="log-item-name"></span>
          <span class="log-item-time">${timeLabel(e.at)}</span>
          <button class="log-item-del" aria-label="Remove">×</button>`;
        row.querySelector('.log-item-name').textContent = e.name;
        row.querySelector('.log-item-del').addEventListener('click', () => removeEntry(e.id));
        card.appendChild(row);
      });
    log.appendChild(card);
  });
}

async function saveDay(entries) {
  dayEntries = entries;
  renderDay();
  try {
    await db.collection(LOGS).doc(selectedDate).set({ entries, updatedAt: new Date().toISOString() }, { merge: true });
    clearError();
  } catch (err) {
    showError('Save failed: ' + err.message);
  }
}

function removeEntry(id) {
  saveDay(dayEntries.filter(e => e.id !== id));
}

// ---------- food library ----------
function subscribeFoods() {
  db.collection(FOODS).onSnapshot(async (snap) => {
    foods = [];
    snap.forEach(d => foods.push({ id: d.id, ...d.data() }));
    foods.sort((a, b) => a.nameLower.localeCompare(b.nameLower));
    if (snap.empty) await seedStarterFoods();
    if (views.pick.style.display !== 'none') renderPicker();
  }, (err) => showError('Could not load foods: ' + err.message));
}

async function seedStarterFoods() {
  try {
    const flag = await db.collection(SETTINGS).doc('seed').get();
    if (flag.exists && flag.data().done) return;
    const batch = db.batch();
    STARTER_FAVOURITES.forEach(name => {
      batch.set(db.collection(FOODS).doc(), {
        name, nameLower: name.toLowerCase(), favourite: true, useCount: 0,
        createdAt: new Date().toISOString()
      });
    });
    batch.set(db.collection(SETTINGS).doc('seed'), { done: true, at: new Date().toISOString() });
    await batch.commit();
  } catch (err) {
    showError('Could not set up starter foods: ' + err.message);
  }
}

async function addNewFood(name) {
  name = (name || '').trim();
  if (!name) return;
  const existing = foods.find(f => f.nameLower === name.toLowerCase());
  if (existing) { pickSelected.add(existing.id); $('food-search').value = ''; renderPicker(); return; }
  const ref = db.collection(FOODS).doc();
  const food = { id: ref.id, name, nameLower: name.toLowerCase(), favourite: false, useCount: 0, createdAt: new Date().toISOString() };
  foods.push(food);
  foods.sort((a, b) => a.nameLower.localeCompare(b.nameLower));
  pickSelected.add(food.id);
  $('food-search').value = '';
  renderPicker();
  try {
    await ref.set({ name: food.name, nameLower: food.nameLower, favourite: false, useCount: 0, createdAt: food.createdAt });
    clearError();
  } catch (err) { showError('Could not add food: ' + err.message); }
}

async function toggleFavourite(food) {
  food.favourite = !food.favourite;
  renderPicker();
  try { await db.collection(FOODS).doc(food.id).update({ favourite: food.favourite }); }
  catch (err) { showError('Could not update favourite: ' + err.message); }
}

// ---------- picker ----------
function openPicker(meal) {
  pickMeal = meal;
  pickSelected = new Set();
  $('pick-meal-name').textContent = MEALS[meal].label;
  $('pick-date').textContent = weekdayLabel(selectedDate) + ' · ' + prettyDate(selectedDate);
  $('food-search').value = '';
  renderPicker();
  showView('pick');
}

function makeChip(food) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip' + (pickSelected.has(food.id) ? ' selected' : '') + (food.favourite ? ' fav' : '');
  const label = document.createElement('span');
  label.textContent = food.name;
  const star = document.createElement('span');
  star.className = 'chip-star';
  star.textContent = food.favourite ? '★' : '☆';
  star.title = food.favourite ? 'Remove from favourites' : 'Add to favourites';
  star.addEventListener('click', (e) => { e.stopPropagation(); toggleFavourite(food); });
  chip.appendChild(label);
  chip.appendChild(star);
  chip.addEventListener('click', () => {
    if (pickSelected.has(food.id)) pickSelected.delete(food.id); else pickSelected.add(food.id);
    renderPicker();
  });
  return chip;
}

function renderPicker() {
  const q = $('food-search').value.trim().toLowerCase();
  const matches = (f) => !q || f.nameLower.includes(q);

  const favList = $('fav-list');
  const allList = $('all-list');
  favList.innerHTML = '';
  allList.innerHTML = '';

  const favs = foods.filter(f => f.favourite && matches(f));
  const rest = foods.filter(f => !f.favourite && matches(f));
  favs.forEach(f => favList.appendChild(makeChip(f)));
  rest.forEach(f => allList.appendChild(makeChip(f)));
  if (favs.length === 0) favList.innerHTML = `<div class="empty-note">${q ? 'No favourites match.' : 'Star a food to keep it here.'}</div>`;
  $('all-empty').style.display = (rest.length === 0) ? '' : 'none';
  $('all-empty').textContent = q ? 'No other foods match.' : 'Nothing here yet. Type a food above to add it.';

  const exact = q && foods.some(f => f.nameLower === q);
  $('add-new-row').style.display = (q && !exact) ? '' : 'none';
  $('add-new-name').textContent = $('food-search').value.trim();

  const n = pickSelected.size;
  const names = [...pickSelected].map(id => (foods.find(f => f.id === id) || {}).name).filter(Boolean);
  $('pick-selected').textContent = n === 0 ? 'Tap foods to pick them' : names.join(', ');
  $('log-selected').disabled = n === 0;
  $('log-selected').textContent = n === 0 ? 'Log' : `Log ${n} to ${MEALS[pickMeal].label}`;
}

async function logSelected() {
  if (pickSelected.size === 0) return;
  const now = new Date().toISOString();
  const chosen = [...pickSelected].map(id => foods.find(f => f.id === id)).filter(Boolean);
  const newEntries = chosen.map(f => ({ id: uid(), meal: pickMeal, name: f.name, foodId: f.id, at: now }));

  showView('day');
  toast(`Logged ${chosen.length} to ${MEALS[pickMeal].label} ✓`);
  await saveDay([...dayEntries, ...newEntries]);

  // bump use counts (best effort)
  const batch = db.batch();
  chosen.forEach(f => {
    f.useCount = (f.useCount || 0) + 1;
    batch.update(db.collection(FOODS).doc(f.id), { useCount: firebase.firestore.FieldValue.increment(1), lastUsed: now });
  });
  batch.commit().catch(() => {});
}

// ---------- summary ----------
function openSummary() {
  showView('summary');
  if (!logsSubscribed) {
    logsSubscribed = true;
    db.collection(LOGS).onSnapshot((snap) => {
      allLogs = {};
      snap.forEach(d => { allLogs[d.id] = Array.isArray(d.data().entries) ? d.data().entries : []; });
      renderSummary();
    }, (err) => showError('Could not load history: ' + err.message));
  } else {
    renderSummary();
  }
}

function rangeDates() {
  const t = todayStr();
  const dates = Object.keys(allLogs).filter(d => allLogs[d].length > 0).sort();
  if (summaryRange === 'all') return dates.filter(d => d <= t);
  const start = offsetDate(t, -(Number(summaryRange) - 1));
  return dates.filter(d => d >= start && d <= t);
}

function renderSummary() {
  const dates = rangeDates();
  const entries = dates.flatMap(d => allLogs[d]);

  // stat tiles
  $('stat-days').textContent = dates.length;
  $('stat-items').textContent = entries.length;
  $('stat-avg').textContent = dates.length ? (entries.length / dates.length).toFixed(1) : '0';
  $('stat-streak').textContent = computeStreak();

  // donut: foods by meal
  const byMeal = {};
  MEAL_ORDER.forEach(m => byMeal[m] = 0);
  entries.forEach(e => { if (byMeal[e.meal] !== undefined) byMeal[e.meal]++; });
  renderDonut(byMeal, entries.length);

  // top foods
  const counts = {};
  entries.forEach(e => { counts[e.name] = (counts[e.name] || 0) + 1; });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
  const bars = $('top-foods');
  bars.innerHTML = '';
  if (top.length === 0) bars.innerHTML = '<div class="summary-empty">No foods logged in this range.</div>';
  const max = top.length ? top[0][1] : 1;
  top.forEach(([name, n]) => {
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.innerHTML = `<div class="bar-name"></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, n / max * 100)}%"></div></div><div class="bar-val">${n}</div>`;
    row.querySelector('.bar-name').textContent = name;
    row.querySelector('.bar-name').title = name;
    bars.appendChild(row);
  });

  // per-day column chart
  renderDailyChart();

  // meals per day
  const md = $('meal-days');
  md.innerHTML = '';
  MEAL_ORDER.forEach(m => {
    const daysWith = dates.filter(d => allLogs[d].some(e => e.meal === m)).length;
    const pct = dates.length ? Math.round(daysWith / dates.length * 100) : 0;
    const tile = document.createElement('div');
    tile.className = 'meal-day-tile';
    tile.innerHTML = `<div class="meal-day-val" style="color:${MEALS[m].color}">${pct}%</div>
      <div class="meal-day-label">${MEALS[m].label}</div>
      <div class="meal-day-sub">${daysWith} of ${dates.length} days</div>`;
    md.appendChild(tile);
  });
}

function computeStreak() {
  let d = todayStr();
  if (!(allLogs[d] && allLogs[d].length)) d = offsetDate(d, -1); // today not logged yet doesn't break it
  let streak = 0;
  while (allLogs[d] && allLogs[d].length) { streak++; d = offsetDate(d, -1); }
  return streak;
}

function renderDonut(byMeal, total) {
  const svg = $('donut');
  const legend = $('donut-legend');
  svg.innerHTML = '';
  legend.innerHTML = '';
  const cx = 100, cy = 100, r = 78, stroke = 30;
  const circ = 2 * Math.PI * r;
  const gap = 2 / circ * 360; // 2px surface gap between segments (degrees)

  if (total === 0) {
    svg.innerHTML = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${stroke}"/>
      <text x="${cx}" y="${cy + 4}" text-anchor="middle" class="donut-center-sub">no data</text>`;
    return;
  }

  const segs = MEAL_ORDER.filter(m => byMeal[m] > 0);
  let angle = -90;
  segs.forEach(m => {
    const sweep = byMeal[m] / total * 360;
    const g = segs.length > 1 ? Math.min(gap, sweep / 3) : 0;
    const a0 = angle + g / 2, a1 = angle + sweep - g / 2;
    angle += sweep;
    svg.appendChild(arcPath(cx, cy, r, a0, a1, stroke, MEALS[m].color, `${MEALS[m].label}: ${byMeal[m]}`));
  });

  const centre = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  centre.setAttribute('x', cx); centre.setAttribute('y', cy + 2);
  centre.setAttribute('text-anchor', 'middle'); centre.setAttribute('class', 'donut-center');
  centre.textContent = total;
  svg.appendChild(centre);
  const sub = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  sub.setAttribute('x', cx); sub.setAttribute('y', cy + 20);
  sub.setAttribute('text-anchor', 'middle'); sub.setAttribute('class', 'donut-center-sub');
  sub.textContent = 'foods';
  svg.appendChild(sub);

  MEAL_ORDER.forEach(m => {
    const pct = Math.round(byMeal[m] / total * 100);
    const row = document.createElement('div');
    row.className = 'legend-row';
    row.innerHTML = `<span class="legend-swatch" style="background:${MEALS[m].color}"></span>
      <span class="legend-name">${MEALS[m].label}</span>
      <span class="legend-val">${byMeal[m]} · ${pct}%</span>`;
    legend.appendChild(row);
  });
}

function arcPath(cx, cy, r, a0, a1, width, color, title) {
  const toXY = (a) => [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)];
  const [x0, y0] = toXY(a0), [x1, y1] = toXY(a1);
  const large = (a1 - a0) > 180 ? 1 : 0;
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  if (a1 - a0 >= 359.9) {
    p.setAttribute('d', `M ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy}`);
  } else {
    p.setAttribute('d', `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`);
  }
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', color);
  p.setAttribute('stroke-width', width);
  const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  t.textContent = title;
  p.appendChild(t);
  return p;
}

function renderDailyChart() {
  const svg = $('daily-chart');
  const tip = $('daily-tooltip');
  svg.innerHTML = '';
  const t = todayStr();
  let nDays = summaryRange === 'all' ? 60 : Number(summaryRange);
  nDays = Math.min(nDays, 60);
  const days = [];
  for (let i = nDays - 1; i >= 0; i--) days.push(offsetDate(t, -i));
  const vals = days.map(d => (allLogs[d] || []).length);
  const max = Math.max(1, ...vals);

  const W = 400, H = 130, padL = 6, padR = 6, padT = 16, padB = 20;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const slot = innerW / nDays;
  const barW = Math.max(2, slot - 2); // 2px gap between bars

  // baseline grid
  const base = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  base.setAttribute('x1', padL); base.setAttribute('x2', W - padR);
  base.setAttribute('y1', padT + innerH); base.setAttribute('y2', padT + innerH);
  base.setAttribute('class', 'grid');
  svg.appendChild(base);

  const ns = 'http://www.w3.org/2000/svg';
  days.forEach((d, i) => {
    const v = vals[i];
    const h = v === 0 ? 2 : Math.max(4, v / max * innerH);
    const x = padL + i * slot + 1;
    const y = padT + innerH - h;
    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('x', x); rect.setAttribute('y', y);
    rect.setAttribute('width', barW); rect.setAttribute('height', h);
    rect.setAttribute('rx', Math.min(4, barW / 2));
    rect.setAttribute('class', 'bar' + (v === 0 ? ' empty' : ''));
    svg.appendChild(rect);
    if (v === max && v > 0 && nDays <= 30) {
      const lbl = document.createElementNS(ns, 'text');
      lbl.setAttribute('x', x + barW / 2); lbl.setAttribute('y', y - 4);
      lbl.setAttribute('class', 'val-label');
      lbl.textContent = v;
      svg.appendChild(lbl);
    }
    const hit = document.createElementNS(ns, 'rect');
    hit.setAttribute('x', padL + i * slot); hit.setAttribute('y', 0);
    hit.setAttribute('width', slot); hit.setAttribute('height', H);
    hit.setAttribute('class', 'hit');
    const show = () => {
      tip.textContent = `${weekdayLabel(d)}, ${prettyDate(d)}: ${v} food${v === 1 ? '' : 's'}`;
      tip.style.display = '';
      const rectBox = svg.getBoundingClientRect();
      const px = (padL + i * slot + slot / 2) / W * rectBox.width;
      tip.style.left = Math.min(Math.max(px, 60), rectBox.width - 60) + 'px';
      tip.style.top = '8px';
      tip.style.transform = 'translateX(-50%)';
    };
    hit.addEventListener('mouseenter', show);
    hit.addEventListener('touchstart', show, { passive: true });
    hit.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    svg.appendChild(hit);
  });
  svg.addEventListener('touchend', () => setTimeout(() => { tip.style.display = 'none'; }, 1200), { passive: true });

  // axis labels: first, middle, last
  [0, Math.floor(nDays / 2), nDays - 1].forEach((i, k) => {
    const lbl = document.createElementNS(ns, 'text');
    lbl.setAttribute('x', padL + i * slot + slot / 2);
    lbl.setAttribute('y', H - 6);
    lbl.setAttribute('text-anchor', k === 0 ? 'start' : k === 2 ? 'end' : 'middle');
    lbl.setAttribute('class', 'axis-label');
    const d = new Date(days[i] + 'T12:00:00');
    lbl.textContent = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    svg.appendChild(lbl);
  });
}
