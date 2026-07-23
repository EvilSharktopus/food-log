// Daily Nutrition & Training Log — Client Logic & Firebase Integration

// Firebase initialization
const firebaseConfig = {
  apiKey: "AIzaSyBfQNvbEDERrDoM816JFmtkOKBsCXFYXCI",
  authDomain: "project-7910201586224417193.firebaseapp.com",
  projectId: "project-7910201586224417193",
  storageBucket: "project-7910201586224417193.firebasestorage.app",
  messagingSenderId: "885278922704",
  appId: "1:885278922704:web:feea02463fa11035094bd5"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();
let messaging = null;
try {
  if (firebase.messaging.isSupported()) {
    messaging = firebase.messaging();
  }
} catch (e) {
  console.log('FCM not supported on this browser/environment.');
}

// App State
let selectedDate = getTodayStr();
let currentDocData = {
  foodEntries: [],
  activities: [],
  garminBurnOverride: null,
  weighIn: {},
  rehabTicks: []
};
let rehabExercises = ["Hip bridges", "Slider hamstring curls", "Prone hamstring curls", "Single-leg work"];
let savedFoodsList = [];
let historicalLogs = {};
let aiResultCache = null;
let selectedAiTag = "Whole food";

// Date Helper Functions
function getTodayStr() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getYesterdayStr(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getOffsetDateStr(dateStr, offset) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadRehabExercises();
  loadSavedFoods();
  loadHistoricalLogs();
  setSelectedDate(getTodayStr());
  initPushNotifications();
});

// Register FCM Push Notifications
async function initPushNotifications() {
  const btn = document.getElementById('fcm-status-btn');
  if (!btn || !messaging) {
    if (btn) btn.style.display = 'none';
    return;
  }

  btn.addEventListener('click', async () => {
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        const token = await messaging.getToken().catch(() => null);
        if (token) {
          await db.collection('fcm_tokens').doc(token.substring(0, 30)).set({
            token,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          btn.textContent = '🔔 Push Notifications Enabled';
          btn.style.color = 'var(--green-text)';
        } else {
          btn.textContent = '🔔 Notifications Allowed';
        }
      } else {
        btn.textContent = '🔕 Push Notifications Blocked';
      }
    } catch (e) {
      console.error('Error requesting notification permission:', e);
    }
  });

  if (Notification.permission === 'granted') {
    btn.textContent = '🔔 Push Notifications Enabled';
    btn.style.color = 'var(--green-text)';
  }
}

// Date Navigation
function setSelectedDate(dateStr) {
  selectedDate = dateStr;
  document.getElementById('date-picker').value = selectedDate;
  const isToday = selectedDate === getTodayStr();
  document.getElementById('today-badge-btn').style.display = isToday ? 'none' : 'inline-block';
  listenToDayLog(selectedDate);
}

// Real-time listener for current selected date
let unsubscribeDayLog = null;
function listenToDayLog(dateStr) {
  if (unsubscribeDayLog) unsubscribeDayLog();

  unsubscribeDayLog = db.collection('food_logs').doc(dateStr).onSnapshot((doc) => {
    const defaults = { foodEntries: [], activities: [], garminBurnOverride: null, weighIn: {}, rehabTicks: [] };
    currentDocData = doc.exists ? Object.assign(defaults, doc.data()) : defaults;
    renderAll();
  }, (err) => {
    console.error('Error loading day log:', err);
  });
}

// Load global rehab exercises from Firestore
function loadRehabExercises() {
  db.collection('food_settings').doc('rehab').onSnapshot((doc) => {
    if (doc.exists && doc.data().exercises) {
      rehabExercises = doc.data().exercises;
    } else {
      db.collection('food_settings').doc('rehab').set({ exercises: rehabExercises });
    }
    renderRehabSection();
  });
}

// Load saved foods from Firestore
function loadSavedFoods() {
  db.collection('saved_foods').onSnapshot((snapshot) => {
    savedFoodsList = [];
    snapshot.forEach(doc => savedFoodsList.push({ id: doc.id, ...doc.data() }));
    renderSavedFoodsDropdown();
  });
}

// Load all historical logs for trend & streak calculations
function loadHistoricalLogs() {
  db.collection('food_logs').onSnapshot((snapshot) => {
    historicalLogs = {};
    snapshot.forEach(doc => { historicalLogs[doc.id] = doc.data(); });
    renderYesterdayAndStreaks();
    renderTrendsSection();
    renderBadgesSection();
  });
}

// Save current date document to Firestore
async function saveCurrentDoc() {
  try {
    await db.collection('food_logs').doc(selectedDate).set({
      ...currentDocData,
      date: selectedDate,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (e) {
    console.error('Error saving to Firestore:', e);
  }
}

// Event Listeners Setup
function setupEventListeners() {
  document.getElementById('date-picker').addEventListener('change', (e) => setSelectedDate(e.target.value));

  document.getElementById('prev-day-btn').addEventListener('click', () => {
    setSelectedDate(getOffsetDateStr(selectedDate, -1));
  });

  document.getElementById('next-day-btn').addEventListener('click', () => {
    setSelectedDate(getOffsetDateStr(selectedDate, 1));
  });

  document.getElementById('today-badge-btn').addEventListener('click', () => setSelectedDate(getTodayStr()));

  // Activity Quick Add
  document.querySelectorAll('.activity-btn').forEach(btn => {
    btn.addEventListener('click', () => showInlineActivityEdit(btn.dataset.name, Number(btn.dataset.kcal)));
  });

  document.getElementById('confirm-activity-btn').addEventListener('click', () => {
    const name = document.getElementById('inline-act-name').textContent;
    const kcal = Number(document.getElementById('inline-act-kcal').value) || 0;
    currentDocData.activities.push({ id: Date.now().toString(), name, kcal });
    hideInlineActivityEdit();
    saveCurrentDoc();
  });

  document.getElementById('cancel-activity-btn').addEventListener('click', hideInlineActivityEdit);

  // Garmin Override
  document.getElementById('save-garmin-btn').addEventListener('click', () => {
    const val = document.getElementById('garmin-override-input').value;
    currentDocData.garminBurnOverride = val !== "" ? Number(val) : null;
    saveCurrentDoc();
  });

  // Rehab Add Exercise
  document.getElementById('add-exercise-btn').addEventListener('click', () => {
    const input = document.getElementById('new-exercise-input');
    const name = input.value.trim();
    if (name && !rehabExercises.includes(name)) {
      rehabExercises.push(name);
      input.value = '';
      db.collection('food_settings').doc('rehab').set({ exercises: rehabExercises });
    }
  });

  document.getElementById('new-exercise-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('add-exercise-btn').click();
  });

  // Food Quick Add
  document.querySelectorAll('.food-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentDocData.foodEntries.push({
        id: Date.now().toString(),
        name: btn.dataset.name,
        kcal: Number(btn.dataset.kcal),
        protein: Number(btn.dataset.protein),
        tag: 'Whole food'
      });
      saveCurrentDoc();
    });
  });

  // Saved Foods Dropdown
  document.getElementById('saved-foods-select').addEventListener('change', (e) => {
    const food = savedFoodsList.find(f => f.id === e.target.value);
    if (food) {
      currentDocData.foodEntries.push({
        id: Date.now().toString(),
        name: food.name,
        kcal: food.kcal,
        protein: food.protein,
        tag: food.tag || 'Whole food'
      });
      saveCurrentDoc();
    }
    e.target.value = '';
  });

  // AI Food Lookup
  document.getElementById('ai-lookup-btn').addEventListener('click', handleAiLookup);
  document.getElementById('ai-lookup-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAiLookup();
  });

  document.querySelectorAll('.tag-option').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tag-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedAiTag = btn.dataset.tag;
    });
  });

  document.getElementById('ai-add-today-btn').addEventListener('click', () => {
    if (!aiResultCache) return;
    currentDocData.foodEntries.push({
      id: Date.now().toString(),
      name: aiResultCache.name,
      kcal: aiResultCache.kcal,
      protein: aiResultCache.protein,
      tag: selectedAiTag
    });
    saveCurrentDoc();
    hideAiResultBox();
  });

  document.getElementById('ai-add-save-btn').addEventListener('click', async () => {
    if (!aiResultCache) return;
    currentDocData.foodEntries.push({
      id: Date.now().toString(),
      name: aiResultCache.name,
      kcal: aiResultCache.kcal,
      protein: aiResultCache.protein,
      tag: selectedAiTag
    });
    saveCurrentDoc();
    await db.collection('saved_foods').add({
      name: aiResultCache.name,
      kcal: aiResultCache.kcal,
      protein: aiResultCache.protein,
      tag: selectedAiTag,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    hideAiResultBox();
  });

  // Weigh-in
  ['weighin-weight', 'weighin-bf', 'weighin-muscle', 'weighin-bmr'].forEach(id => {
    document.getElementById(id).addEventListener('change', saveWeighInFromUI);
  });
}

// Activity inline edit toggle
function showInlineActivityEdit(name, defaultKcal) {
  document.getElementById('inline-act-name').textContent = name;
  document.getElementById('inline-act-kcal').value = defaultKcal;
  document.getElementById('activity-inline-edit').style.display = 'flex';
}

function hideInlineActivityEdit() {
  document.getElementById('activity-inline-edit').style.display = 'none';
}

// AI Food Lookup Handler
async function handleAiLookup() {
  const input = document.getElementById('ai-lookup-input');
  const query = input.value.trim();
  const errBox = document.getElementById('ai-error-box');
  if (!query) return;

  errBox.style.display = 'none';
  document.getElementById('ai-lookup-btn').textContent = 'Searching...';

  try {
    const res = await fetch('/api/food-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Food lookup failed.');
    }

    const data = await res.json();
    if (!data.name || typeof data.kcal !== 'number') throw new Error('Invalid response from lookup.');

    aiResultCache = data;
    document.getElementById('ai-result-title').textContent = `${data.name} — ${data.kcal} kcal, ${data.protein}g protein`;
    document.getElementById('ai-result-box').style.display = 'block';
    input.value = '';
  } catch (err) {
    errBox.textContent = err.message || 'Lookup failed. Enter food manually.';
    errBox.style.display = 'block';
  } finally {
    document.getElementById('ai-lookup-btn').textContent = 'Estimate';
  }
}

function hideAiResultBox() {
  document.getElementById('ai-result-box').style.display = 'none';
  aiResultCache = null;
}

// Save weigh-in to current document
function saveWeighInFromUI() {
  const parse = (id) => { const v = parseFloat(document.getElementById(id).value); return isNaN(v) ? null : v; };
  currentDocData.weighIn = {
    weight: parse('weighin-weight'),
    bodyFat: parse('weighin-bf'),
    muscleMass: parse('weighin-muscle'),
    bmr: parse('weighin-bmr')
  };
  saveCurrentDoc();
}

// ──────────────────────────────────────────────────────────────────
// RENDERING
// ──────────────────────────────────────────────────────────────────

function renderAll() {
  renderTotalsPanel();
  renderEveningBanner();
  renderActivitySection();
  renderRehabSection();
  renderFoodSection();
  renderWeighInSection();
  renderYesterdayAndStreaks();
  renderTrendsSection();
  renderBadgesSection();
}

function getEffectiveBMR() {
  if (currentDocData.weighIn?.bmr) return currentDocData.weighIn.bmr;
  const dates = Object.keys(historicalLogs).sort().reverse();
  for (const d of dates) {
    if (historicalLogs[d]?.weighIn?.bmr) return historicalLogs[d].weighIn.bmr;
  }
  return 2230;
}

function renderTotalsPanel() {
  const food = currentDocData.foodEntries || [];
  const acts = currentDocData.activities || [];

  const kcalIn = food.reduce((s, f) => s + (Number(f.kcal) || 0), 0);
  const proteinIn = food.reduce((s, f) => s + (Number(f.protein) || 0), 0);
  const estBurn = acts.reduce((s, a) => s + (Number(a.kcal) || 0), 0);
  const actualBurn = (currentDocData.garminBurnOverride != null) ? Number(currentDocData.garminBurnOverride) : estBurn;
  const isTraining = acts.length > 0;
  const target = isTraining ? 2600 : 2300;
  const left = target - kcalIn;
  const bmr = getEffectiveBMR();
  const expenditure = bmr + actualBurn;
  const deficit = expenditure - kcalIn;

  document.getElementById('total-kcal-in').textContent = kcalIn;
  document.getElementById('total-protein-in').textContent = `${proteinIn}g`;
  document.getElementById('total-burn').textContent = actualBurn;

  const pct = Math.min(100, Math.round((proteinIn / 180) * 100));
  const fill = document.getElementById('protein-progress-fill');
  fill.style.width = `${pct}%`;
  fill.style.background = proteinIn >= 180 ? 'var(--green-main)' : 'var(--amber-main)';
  document.getElementById('protein-target-caption').textContent =
    proteinIn >= 180 ? 'Target reached! (180g+)' : `${180 - proteinIn}g to target`;

  const leftCard = document.getElementById('left-today-card');
  const leftVal = document.getElementById('left-today-val');
  leftCard.className = `left-today-card ${left >= 0 ? 'positive' : 'over'}`;
  leftVal.textContent = left >= 0 ? `${left} kcal` : `${Math.abs(left)} kcal over`;

  document.getElementById('totals-explainer').textContent =
    `Target: ${target} kcal (${isTraining ? 'Training' : 'Rest'} Day) | Expenditure: ${expenditure} kcal (${bmr} BMR + ${actualBurn} burn) | Actual Deficit: ${deficit} kcal`;
}

function renderEveningBanner() {
  const banner = document.getElementById('evening-check-banner');
  const isToday = selectedDate === getTodayStr();
  const now = new Date();
  const isAfter1945 = now.getHours() > 19 || (now.getHours() === 19 && now.getMinutes() >= 45);

  if (!isToday || !isAfter1945) { banner.style.display = 'none'; return; }
  banner.style.display = 'flex';

  const food = currentDocData.foodEntries || [];
  const acts = currentDocData.activities || [];
  const kcalIn = food.reduce((s, f) => s + (Number(f.kcal) || 0), 0);
  const proteinIn = food.reduce((s, f) => s + (Number(f.protein) || 0), 0);
  const target = acts.length > 0 ? 2600 : 2300;
  const left = target - kcalIn;
  const textEl = document.getElementById('evening-banner-text');

  if (left >= 250) {
    banner.className = 'evening-banner info';
    let msg = `${left} kcal left today.`;
    if (proteinIn < 180) msg += ` ${180 - proteinIn}g short on protein — make your snack protein-forward.`;
    textEl.textContent = msg;
  } else if (left >= 0) {
    banner.className = 'evening-banner warning';
    textEl.textContent = `Only ${left} kcal left. This is the window — water first, wait twenty minutes.`;
  } else {
    banner.className = 'evening-banner danger';
    textEl.textContent = `${Math.abs(left)} over. Kitchen's closed.`;
  }
}

function renderActivitySection() {
  const container = document.getElementById('activities-list');
  container.innerHTML = '';
  const acts = currentDocData.activities || [];
  const estSum = acts.reduce((s, a) => s + (Number(a.kcal) || 0), 0);

  acts.forEach(act => {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `<div><span class="item-name">${act.name}</span><span class="item-stats">${act.kcal} kcal</span></div><button class="remove-btn" onclick="removeActivity('${act.id}')">✕</button>`;
    container.appendChild(row);
  });

  const garminInput = document.getElementById('garmin-override-input');
  garminInput.placeholder = estSum > 0 ? `Estimate: ${estSum} kcal` : 'Enter Garmin burn';
  garminInput.value = (currentDocData.garminBurnOverride != null) ? currentDocData.garminBurnOverride : '';
}

window.removeActivity = (id) => {
  currentDocData.activities = currentDocData.activities.filter(a => a.id !== id);
  saveCurrentDoc();
};

function renderRehabSection() {
  const container = document.getElementById('rehab-checklist');
  container.innerHTML = '';
  const ticks = currentDocData.rehabTicks || [];

  rehabExercises.forEach(ex => {
    const isChecked = ticks.includes(ex);
    const item = document.createElement('div');
    item.className = `rehab-item ${isChecked ? 'checked' : ''}`;
    const safeEx = ex.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    item.innerHTML = `
      <label>
        <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleRehabTick('${safeEx}')">
        <span>${ex}</span>
      </label>
      <button class="remove-btn" onclick="removeRehabExercise('${safeEx}')">✕</button>`;
    container.appendChild(item);
  });

  const now = new Date();
  const isToday = selectedDate === getTodayStr();
  const nudge = document.getElementById('rehab-nudge');
  nudge.style.display = (isToday && now.getHours() >= 20 && ticks.length === 0) ? 'block' : 'none';
}

window.toggleRehabTick = (ex) => {
  let ticks = currentDocData.rehabTicks || [];
  currentDocData.rehabTicks = ticks.includes(ex) ? ticks.filter(t => t !== ex) : [...ticks, ex];
  saveCurrentDoc();
};

window.removeRehabExercise = (ex) => {
  rehabExercises = rehabExercises.filter(e => e !== ex);
  db.collection('food_settings').doc('rehab').set({ exercises: rehabExercises });
};

function renderFoodSection() {
  const container = document.getElementById('food-entries-list');
  container.innerHTML = '';
  const entries = currentDocData.foodEntries || [];

  entries.forEach(item => {
    const tagClassMap = { 'Whole food': 'tag-whole', 'Protein': 'tag-protein', 'Treat': 'tag-treat' };
    const tagClass = tagClassMap[item.tag] || 'tag-whole';
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
      <div>
        <span class="item-name">${item.name}</span>
        <span class="item-stats">${item.kcal} kcal, ${item.protein}g P</span>
        ${item.tag ? `<span class="item-tag ${tagClass}">${item.tag}</span>` : ''}
      </div>
      <button class="remove-btn" onclick="removeFoodEntry('${item.id}')">✕</button>`;
    container.appendChild(row);
  });

  renderSnackReport();
}

window.removeFoodEntry = (id) => {
  currentDocData.foodEntries = currentDocData.foodEntries.filter(f => f.id !== id);
  saveCurrentDoc();
};

function renderSavedFoodsDropdown() {
  const select = document.getElementById('saved-foods-select');
  select.innerHTML = '<option value="">-- Add from Saved Foods --</option>';
  savedFoodsList.forEach(food => {
    const opt = document.createElement('option');
    opt.value = food.id;
    opt.textContent = `${food.name} (${food.kcal} kcal / ${food.protein}g P)`;
    select.appendChild(opt);
  });
}

function renderSnackReport() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  let whole = 0, protein = 0, treat = 0;

  Object.keys(historicalLogs).forEach(d => {
    if (new Date(d + 'T12:00:00') >= cutoff) {
      (historicalLogs[d].foodEntries || []).forEach(item => {
        if (item.tag === 'Whole food') whole++;
        else if (item.tag === 'Protein') protein++;
        else if (item.tag === 'Treat') treat++;
      });
    }
  });

  document.getElementById('count-whole').textContent = whole;
  document.getElementById('count-protein').textContent = protein;
  document.getElementById('count-treat').textContent = treat;
}

function renderWeighInSection() {
  const wi = currentDocData.weighIn || {};
  document.getElementById('weighin-weight').value = wi.weight || '';
  document.getElementById('weighin-bf').value = wi.bodyFat || '';
  document.getElementById('weighin-muscle').value = wi.muscleMass || '';
  document.getElementById('weighin-bmr').value = wi.bmr || '';

  const banner = document.getElementById('goal-weight-banner');
  if (wi.weight && wi.bodyFat) {
    const bfPct = Number(wi.bodyFat);
    const goalWeight = (Number(wi.weight) * (1 - bfPct / 100)) / (1 - 0.14);
    banner.style.display = 'block';
    banner.textContent = bfPct > 14
      ? `${(bfPct - 14).toFixed(1)}% to 14% BF goal — goal weight at current lean mass: ${goalWeight.toFixed(1)} lbs`
      : `🎯 14% Body Fat Goal Reached! (${bfPct}% current)`;
  } else {
    banner.style.display = 'none';
  }
}

function renderYesterdayAndStreaks() {
  const yesterdayStr = getYesterdayStr(getTodayStr());
  const yDoc = historicalLogs[yesterdayStr];
  const yCard = document.getElementById('yesterday-card');

  if (yDoc?.foodEntries?.length > 0) {
    yCard.style.display = 'block';
    const kcal = yDoc.foodEntries.reduce((s, f) => s + (Number(f.kcal) || 0), 0);
    const prot = yDoc.foodEntries.reduce((s, f) => s + (Number(f.protein) || 0), 0);
    const target = (yDoc.activities || []).length > 0 ? 2600 : 2300;
    const hitCal = kcal <= target, hitProt = prot >= 180;

    document.getElementById('yesterday-stats').textContent = `${kcal} kcal, ${prot}g P`;
    const el = document.getElementById('yesterday-verdict');
    if (hitCal && hitProt) {
      el.className = 'verdict-badge verdict-success';
      el.textContent = 'Both targets hit.';
    } else {
      el.className = 'verdict-badge verdict-miss';
      const parts = [];
      if (!hitCal) parts.push(`${kcal - target} over calories`);
      if (!hitProt) parts.push(`${180 - prot}g short on protein`);
      el.textContent = parts.join(', ');
    }
  } else {
    yCard.style.display = 'none';
  }

  document.getElementById('nutrition-streak-val').textContent = calculateNutritionStreak();
  document.getElementById('rehab-streak-val').textContent = `${calculateRehabStreak()}d streak`;
}

function isDaySuccessful(dateStr) {
  const doc = historicalLogs[dateStr];
  if (!doc?.foodEntries?.length) return false;
  const kcal = doc.foodEntries.reduce((s, f) => s + (Number(f.kcal) || 0), 0);
  const prot = doc.foodEntries.reduce((s, f) => s + (Number(f.protein) || 0), 0);
  const target = (doc.activities || []).length > 0 ? 2600 : 2300;
  return kcal <= target && prot >= 180;
}

function calculateNutritionStreak() {
  let streak = 0;
  let curr = getTodayStr();
  if (!isDaySuccessful(curr)) curr = getYesterdayStr(curr);
  while (historicalLogs[curr] && isDaySuccessful(curr)) {
    streak++;
    curr = getYesterdayStr(curr);
  }
  return streak;
}

function calculateRehabStreak() {
  let streak = 0;
  let curr = getTodayStr();
  if (!(historicalLogs[curr]?.rehabTicks?.length > 0)) curr = getYesterdayStr(curr);
  while (historicalLogs[curr]?.rehabTicks?.length > 0) {
    streak++;
    curr = getYesterdayStr(curr);
  }
  return streak;
}

function renderTrendsSection() {
  const dates = Object.keys(historicalLogs).sort();
  if (!dates.length) return;

  const last7 = dates.slice(-7);
  const avg = (arr, fn) => Math.round(arr.reduce((s, d) => s + fn(d), 0) / (arr.length || 1));
  const sumKcal = d => (historicalLogs[d].foodEntries || []).reduce((s, f) => s + (Number(f.kcal) || 0), 0);
  const sumProt = d => (historicalLogs[d].foodEntries || []).reduce((s, f) => s + (Number(f.protein) || 0), 0);

  const avgK = avg(last7, sumKcal);
  const avgP = avg(last7, sumProt);

  const protEl = document.getElementById('trend-avg-protein');
  protEl.textContent = `${avgP}g`;
  protEl.className = `trend-val ${avgP >= 180 ? 'target-met' : 'target-missed'}`;
  document.getElementById('trend-avg-kcal').textContent = `${avgK} kcal`;

  let deficitDays = 0;
  dates.forEach(d => {
    const doc = historicalLogs[d];
    const kcal = sumKcal(d);
    const burn = doc.garminBurnOverride || (doc.activities || []).reduce((s, a) => s + (Number(a.kcal) || 0), 0);
    const bmr = doc.weighIn?.bmr || 2230;
    if (kcal > 0 && bmr + burn > kcal) deficitDays++;
  });
  document.getElementById('trend-deficit-days').textContent = `${deficitDays} / ${dates.length}`;

  const wDates = dates.filter(d => historicalLogs[d]?.weighIn?.weight);
  if (wDates.length > 0) {
    const latest = historicalLogs[wDates[wDates.length - 1]].weighIn.weight;
    const first = historicalLogs[wDates[0]].weighIn.weight;
    const diff = (latest - first).toFixed(1);
    document.getElementById('trend-weight').textContent = `${latest} lbs (${diff > 0 ? '+' : ''}${diff} lbs)`;
  } else {
    document.getElementById('trend-weight').textContent = 'No entries yet';
  }

  const last14 = dates.slice(-14);
  const rehabDays = last14.filter(d => (historicalLogs[d]?.rehabTicks || []).length > 0).length;
  document.getElementById('trend-rehab-count').textContent = `${rehabDays} / 14 days`;

  renderBarChart('chart-protein-svg', last14, sumProt, 220, '#16a34a');
  renderBarChart('chart-kcal-svg', last14, sumKcal, 3200, '#2563eb');
}

function renderBarChart(svgId, datesList, valueFn, maxVal, color) {
  const svg = document.getElementById(svgId);
  if (!svg) return;
  svg.innerHTML = '';

  const width = svg.clientWidth || 300;
  const height = svg.clientHeight || 90;
  const n = datesList.length || 1;
  const barW = Math.max(8, Math.floor((width - n * 4) / n));

  datesList.forEach((d, i) => {
    const val = valueFn(d);
    const barH = Math.min(height, Math.round((val / maxVal) * height));
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', i * (barW + 4) + 6);
    rect.setAttribute('y', height - barH);
    rect.setAttribute('width', barW);
    rect.setAttribute('height', barH);
    rect.setAttribute('fill', color);
    rect.setAttribute('rx', '3');
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${d}: ${val}`;
    rect.appendChild(title);
    svg.appendChild(rect);
  });
}

function renderBadgesSection() {
  const dates = Object.keys(historicalLogs);
  const streak = calculateNutritionStreak();
  const rehabStreak = calculateRehabStreak();

  let proteinDays = 0, lowestBf = 99;
  dates.forEach(d => {
    const prot = (historicalLogs[d].foodEntries || []).reduce((s, f) => s + (Number(f.protein) || 0), 0);
    if (prot >= 180) proteinDays++;
    if (historicalLogs[d].weighIn?.bodyFat && historicalLogs[d].weighIn.bodyFat < lowestBf) {
      lowestBf = historicalLogs[d].weighIn.bodyFat;
    }
  });

  [
    ['badge-first', dates.length >= 1],
    ['badge-7d-log', dates.length >= 7],
    ['badge-3d-streak', streak >= 3],
    ['badge-7d-streak', streak >= 7],
    ['badge-14d-streak', streak >= 14],
    ['badge-10p', proteinDays >= 10],
    ['badge-3r', rehabStreak >= 3],
    ['badge-7r', rehabStreak >= 7],
    ['badge-bf14', lowestBf <= 14.0]
  ].forEach(([id, earned]) => {
    document.getElementById(id)?.classList.toggle('earned', earned);
  });
}
