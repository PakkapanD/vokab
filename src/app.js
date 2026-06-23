// Vokab - Vocabulary Learning App
// Offline-first spaced repetition flashcards for language learning

// ====== Config ======
const PROFILE_NAMES = ["Nesta", "Pordee", "Non", "Poom", "Modi", "Raymond"];
const CLOUD_CFG_KEY = "vokab.cloud";
const CLOUD_DEFAULT = {
  url: "https://slpnksjbtkmwrwanzcdo.supabase.co",
  key: "sb_publishable_qsGTPjzn3NKqeBIJ69Ua8Q_dmxD79md"
};
const DAY = 86400000;

// ====== State ======
let activeName = localStorage.getItem("vokab.active") || null;
if (activeName && !PROFILE_NAMES.includes(activeName)) activeName = null;

let DB = activeName ? load() : null;
let currentPack = activeName ? (localStorage.getItem('vokab.pack') || Object.keys(PACKS)[0]) : null;
let view = 'study';
let revealed = false;
let current = null;
let studyMode = localStorage.getItem('vokab.mode') || 'mode1';
let STUDY_SAY = [];
let pushT = null;

// ====== Utils ======
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const disp = (w) => w.replace(/'(?!s\b)/g, '');
const say = (w) => w.replace(/'/g, '').replace(/\([^)]*\)/g, '').replace(/[=].*$/, '')
  .replace(/\+/g, '').replace(/[\/]/g, ' ').replace(/\s+/g, ' ').trim();
const cryptoId = () => Math.random().toString(36).slice(2, 10);
const dataKey = () => "vokab.v2." + activeName;

// ====== Storage ======
function load() {
  let s = localStorage.getItem(dataKey());
  if (s) {
    try {
      const db = JSON.parse(s);
      if (db && db.cards) { syncPacks(db); return db; }
    } catch (e) { }
  }
  const db = { cards: [], created: Date.now(), updated: 0 };
  syncPacks(db);
  save(db);
  return db;
}

function save(db) {
  if (!activeName) return;
  db.updated = Date.now();
  localStorage.setItem(dataKey(), JSON.stringify(db));
  schedulePush();
}

function toCard(e, pack) {
  return {
    id: cryptoId(), pack, th: e.th, pos: e.pos || "", groups: e.groups || [],
    definition: e.definition || "", example: e.example || "",
    ease: 2.5, interval: 0, reps: 0, due: Date.now(), lapses: 0
  };
}

function syncPacks(db) {
  for (const pack in PACKS) {
    for (const e of PACKS[pack]) {
      const has = db.cards.some(c => c.pack === pack && c.th === e.th);
      if (!has) {
        db.cards.push(toCard(e, pack));
      } else {
        const c = db.cards.find(c => c.pack === pack && c.th === e.th);
        c.pos = e.pos || "";
        c.groups = e.groups || [];
        c.definition = e.definition || "";
        c.example = e.example || "";
      }
    }
  }
}

// Migration: old flat "vokab.v2" → first fixed profile
(function() {
  const old = localStorage.getItem("vokab.v2");
  if (old != null) {
    const first = PROFILE_NAMES[0];
    if (!localStorage.getItem("vokab.v2." + first)) {
      localStorage.setItem("vokab.v2." + first, old);
    }
    localStorage.removeItem("vokab.v2");
  }
})();

// ====== Spaced Repetition (SM-2) ======
function schedule(card, rating) {
  card.reps++;
  if (rating === 'again') {
    card.lapses++;
    card.interval = 0;
    card.ease = Math.max(1.3, card.ease - 0.2);
    card.due = Date.now() + 60 * 1000;
  } else if (rating === 'good') {
    if (card.interval === 0) card.interval = 1;
    else if (card.interval === 1) card.interval = 3;
    else card.interval = Math.round(card.interval * card.ease);
    card.due = Date.now() + card.interval * DAY;
  } else {
    card.ease += 0.15;
    card.interval = card.interval === 0 ? 4 : Math.round(card.interval * card.ease * 1.3);
    card.due = Date.now() + card.interval * DAY;
  }
  save(DB);
}

function packCards(pack) {
  return DB.cards.filter(c => c.pack === pack);
}

function dueCards(pack) {
  const now = Date.now();
  return packCards(pack).filter(c => c.due <= now).sort((a, b) => a.due - b.due);
}

// ====== Audio ======
function speak(text) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (e) { }
}

function speakWord(i) {
  if (STUDY_SAY[i]) speak(STUDY_SAY[i]);
}

// ====== Cloud Sync (Supabase) ======
function cloudCfg() {
  try {
    const c = JSON.parse(localStorage.getItem(CLOUD_CFG_KEY));
    if (c && c.url && c.key) return c;
  } catch (e) { }
  return CLOUD_DEFAULT;
}

function cloudOn() {
  const c = cloudCfg();
  return !!(c.url && c.key);
}

function cloudHeaders(extra) {
  const c = cloudCfg();
  return Object.assign({
    apikey: c.key,
    Authorization: "Bearer " + c.key
  }, extra || {});
}

function restBase() {
  return cloudCfg().url.replace(/\/+$/, '').replace(/\/rest\/v1$/, '') + "/rest/v1/vokab_profiles";
}

async function cloudPull(name) {
  if (!cloudOn()) return null;
  try {
    const url = restBase() + "?name=eq." + encodeURIComponent(name) + "&select=data";
    const r = await fetch(url, { headers: cloudHeaders() });
    if (!r.ok) return null;
    const rows = await r.json();
    return (rows && rows[0] && rows[0].data) || null;
  } catch (e) {
    return null;
  }
}

async function cloudPush(name, data) {
  if (!cloudOn()) return false;
  try {
    const r = await fetch(restBase(), {
      method: "POST",
      headers: cloudHeaders({ "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" }),
      body: JSON.stringify({ name, data })
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

function schedulePush() {
  if (!cloudOn() || !activeName) return;
  clearTimeout(pushT);
  const name = activeName, snap = DB;
  pushT = setTimeout(() => {
    if (snap) cloudPush(name, snap);
  }, 800);
}

// ====== Navigation ======
function go(v) {
  view = v;
  revealed = false;
  ['study', 'words'].forEach(n => {
    const el = document.getElementById('nav-' + n);
    if (el) el.classList.toggle('on', n === v);
  });
  const nav = document.querySelector('nav');
  nav.classList.toggle('hidden', !activeName || !currentPack);
  render();
}

function render() {
  renderHeader();
  if (!activeName) return renderProfileChooser();
  if (!currentPack) return renderPackChooser();
  if (view === 'study') return renderStudy();
  if (view === 'words') return renderWords();
}

function flash(msg) {
  const f = document.createElement('div');
  f.textContent = msg;
  f.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--accent);color:#0c1024;padding:8px 16px;border-radius:999px;font-weight:600;z-index:99';
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 1200);
}

// ====== Header ======
function renderHeader() {
  const headerControls = document.querySelector('.header-controls');
  if (!activeName) {
    headerControls.style.display = 'none';
    return;
  }

  headerControls.style.display = 'flex';
  document.getElementById('current-profile').textContent = activeName;
  document.getElementById('current-pack').textContent = currentPack || 'Select pack';

  const modeLabels = { mode1: 'Mode 1', mode2: 'Mode 2', mode3: 'Mode 3' };
  document.getElementById('current-mode').textContent = modeLabels[studyMode] || 'Mode 1';
}

// ====== Dropdowns ======
function toggleProfileMenu() {
  const dd = document.getElementById('profile-dropdown');
  const show = dd.style.display === 'none';

  if (show) {
    dd.innerHTML = PROFILE_NAMES.map(n => {
      const active = n === activeName ? 'var(--accent)' : 'var(--ink)';
      const bg = n === activeName ? 'var(--card2)' : 'transparent';
      return `<div style="padding:10px 12px;cursor:pointer;color:${active};background:${bg};font-size:13px" onclick="selectProfile('${n}');toggleProfileMenu()">${esc(n)}</div>`;
    }).join('');
  }

  dd.style.display = show ? 'block' : 'none';
}

function togglePackMenu() {
  const dd = document.getElementById('pack-dropdown');
  const show = dd.style.display === 'none';

  if (show) {
    dd.innerHTML = Object.keys(PACKS).map(name => {
      const active = name === currentPack ? 'var(--accent)' : 'var(--ink)';
      const bg = name === currentPack ? 'var(--card2)' : 'transparent';
      return `<div style="padding:10px 12px;cursor:pointer;color:${active};background:${bg};font-size:13px" onclick="selectPack('${esc(name)}');togglePackMenu()">${esc(name)}</div>`;
    }).join('');
  }

  dd.style.display = show ? 'block' : 'none';
}

function toggleModeMenu() {
  const dd = document.getElementById('mode-dropdown');
  const show = dd.style.display === 'none';

  if (show) {
    const modes = [
      { id: 'mode1', label: 'Mode 1: English → Thai + Synonyms', desc: 'Hard vocab' },
      { id: 'mode2', label: 'Mode 2: Thai → English', desc: 'Basic learning' },
      { id: 'mode3', label: 'Mode 3: English → Definition', desc: 'Pure English' }
    ];
    dd.innerHTML = modes.map(m => {
      const active = m.id === studyMode ? 'var(--accent)' : 'var(--ink)';
      const bg = m.id === studyMode ? 'var(--card2)' : 'transparent';
      return `<div style="padding:10px 12px;cursor:pointer;color:${active};background:${bg};font-size:12px" onclick="selectMode('${m.id}');toggleModeMenu()">
        <div style="font-weight:600">${esc(m.label)}</div>
        <div style="font-size:11px;color:var(--muted)">${esc(m.desc)}</div>
      </div>`;
    }).join('');
  }

  dd.style.display = show ? 'block' : 'none';
}

function selectPack(name) {
  currentPack = name;
  localStorage.setItem('vokab.pack', name);
  revealed = false;
  view = 'study';
  render();
}

function selectMode(mode) {
  studyMode = mode;
  localStorage.setItem('vokab.mode', mode);
  revealed = false;
  render();
}

// ====== Profile Selection ======
function pickProfile(i) {
  selectProfile(PROFILE_NAMES[i]);
}

async function selectProfile(name) {
  if (!PROFILE_NAMES.includes(name)) return;

  activeName = name;
  localStorage.setItem("vokab.active", name);
  DB = load();
  currentPack = localStorage.getItem('vokab.pack') || Object.keys(PACKS)[0];
  revealed = false;
  view = 'study';
  render();
  flash('Hi ' + name + ' 👋');

  if (!cloudOn()) return;

  flash('Syncing…');
  const remote = await cloudPull(name);
  if (name !== activeName) return;

  if (remote && (remote.updated || 0) > (DB.updated || 0)) {
    DB = remote;
    syncPacks(DB);
    localStorage.setItem(dataKey(), JSON.stringify(DB));
    render();
    flash('Synced ✓');
  } else {
    cloudPush(name, DB);
    flash('Up to date ✓');
  }
}

// ====== Views ======
function renderProfileChooser() {
  const m = document.getElementById('main');
  const chooser = PROFILE_NAMES.map((n, i) => {
    const initial = esc((n[0] || '?').toUpperCase());
    return `<div class="pack" onclick="pickProfile(${i})">
      <div style="flex:1;display:flex;align-items:center;gap:14px">
        <div style="width:46px;height:46px;border-radius:12px;background:var(--accent);color:#0c1024;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800">${initial}</div>
        <div>
          <div class="pname">${esc(n)}</div>
          <div class="pmeta">tap to study as ${esc(n)}</div>
        </div>
      </div>
      <div class="parrow">›</div>
    </div>`;
  }).join('');

  m.innerHTML = `<div class="small" style="margin:6px 4px 14px">Who's studying?</div>` + chooser;
}

function renderPackChooser() {
  const m = document.getElementById('main');
  const chooser = Object.keys(PACKS).map(name => {
    const cards = packCards(name);
    const total = cards.length;
    const learned = cards.filter(c => c.reps > 0).length;
    const due = dueCards(name).length;
    const pct = total ? Math.round(learned / total * 100) : 0;

    return `<div class="pack" onclick="selectPack('${esc(name)}')">
      <div style="flex:1">
        <div class="pname">${esc(name)}</div>
        <div class="pmeta">${total} groups · ${learned} started · <b style="color:var(--accent)">${due} due</b></div>
        <div class="bar"><i style="width:${pct}%"></i></div>
      </div>
      <div class="parrow">›</div>
    </div>`;
  }).join('');

  m.innerHTML = `<div class="small" style="margin:6px 4px 14px">Choose a pack to learn.</div>` + chooser;
}

function renderStudy() {
  const m = document.getElementById('main');
  if (!currentPack) {
    m.innerHTML = `<div class="done"><div class="big">📦</div><h2>Pick a pack first</h2></div>`;
    current = null;
    return;
  }

  const due = dueCards(currentPack);
  if (due.length === 0) {
    m.innerHTML = `<div class="done"><div class="big">✅</div><h2>All caught up!</h2><p>No new cards due in <b>${esc(currentPack)}</b> right now.</p></div>`;
    current = null;
    return;
  }

  current = due[0];
  const c = current;

  STUDY_SAY = [];
  const tiersHtml = c.groups.map(g => {
    const chips = g.map(w => {
      const i = STUDY_SAY.length;
      STUDY_SAY.push(say(w));
      return `<span class="chip" onclick="speakWord(${i})">${esc(disp(w))}</span>`;
    }).join('');
    return `<div class="tier">${chips}</div>`;
  }).join('');

  let front, backContent, showTiers = false;
  const firstWord = c.groups[0] && c.groups[0][0] ? disp(c.groups[0][0]) : 'Word';

  if (studyMode === 'mode1') {
    front = firstWord;
    const defSection = c.definition ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)"><div style="font-size:12px;color:var(--muted);font-style:italic;margin-bottom:6px">Definition:</div><div style="font-size:14px;line-height:1.6">${esc(c.definition)}</div>${c.example ? `<div style="margin-top:8px;padding:8px;background:rgba(0,0,0,0.2);border-radius:6px;font-style:italic;color:var(--muted)">"${esc(c.example)}"</div>` : ''}</div>` : '';
    backContent = `<div style="margin-bottom:12px"><div style="font-size:14px;color:var(--muted);font-style:italic;margin-bottom:8px">Thai definition:</div><div style="font-size:16px;font-weight:600">${esc(c.th)}</div></div><div style="margin-bottom:12px"><div style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">English synonyms:</div><div class="tiers">${tiersHtml}</div></div>${defSection}`;
  } else if (studyMode === 'mode2') {
    front = c.th;
    const defSection = c.definition ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)"><div style="font-size:12px;color:var(--muted);font-style:italic;margin-bottom:6px">Definition:</div><div style="font-size:14px;line-height:1.6">${esc(c.definition)}</div>${c.example ? `<div style="margin-top:8px;padding:8px;background:rgba(0,0,0,0.2);border-radius:6px;font-style:italic;color:var(--muted)">"${esc(c.example)}"</div>` : ''}</div>` : '';
    backContent = tiersHtml + defSection;
    showTiers = true;
  } else if (studyMode === 'mode3') {
    front = firstWord;
    const exampleSection = c.example ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)"><div style="font-size:12px;color:var(--muted);font-style:italic;margin-bottom:6px">Example:</div><div style="padding:8px;background:rgba(0,0,0,0.2);border-radius:6px;font-style:italic;color:var(--muted);line-height:1.6">"${esc(c.example)}"</div></div>` : '';
    backContent = `<div style="margin-bottom:12px"><div style="font-size:14px;color:var(--muted);font-style:italic;margin-bottom:8px">Definition:</div><div style="font-size:16px;font-weight:600">${esc(c.definition || c.th)}</div></div><div style="margin-bottom:12px"><div style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Similar words:</div><div class="tiers">${tiersHtml}</div></div>${exampleSection}`;
  }

  m.innerHTML = `<div class="card">
    <div style="min-height:200px;display:flex;align-items:center;justify-content:center;border:2px solid var(--line);border-radius:12px;padding:24px;text-align:center;margin:20px 0">
      <div style="font-size:36px;font-weight:700;letter-spacing:.5px">${esc(front)}</div>
    </div>
    <div id="answer" class="${revealed ? '' : 'hidden'}">
      <div style="padding:16px;background:var(--card2);border-radius:12px;margin:16px 0">${backContent}</div>
      ${showTiers ? `<div class="small" style="margin-top:8px;text-align:center">Tap a word to hear it. Lines separate easy → harder words.</div>` : ''}
      <div class="row" style="margin-top:20px;gap:6px">
        <button class="act b-again" onclick="rate('again')">Again</button>
        <button class="act b-good" onclick="rate('good')">Good</button>
        <button class="act b-easy" onclick="rate('easy')">Easy</button>
      </div>
    </div>
    <div id="prompt" class="${revealed ? 'hidden' : ''}">
      <div class="row" style="margin-top:20px">
        <button class="act b-show" onclick="reveal()" style="font-size:18px">Reveal</button>
      </div>
    </div>
  </div>`;
}

function reveal() {
  revealed = true;
  renderStudy();
}

function rate(r) {
  if (!current) return;
  schedule(current, r);
  revealed = false;
  renderStudy();
  renderHeader();
}

function renderWords() {
  const m = document.getElementById('main');
  if (!currentPack) {
    m.innerHTML = `<div class="done"><div class="big">📚</div></div>`;
    return;
  }

  const cards = packCards(currentPack);
  const sorted = cards.sort((a, b) => {
    const aIsDue = a.due <= Date.now();
    const bIsDue = b.due <= Date.now();
    if (aIsDue !== bIsDue) return aIsDue ? -1 : 1;

    const aIsNew = a.reps === 0;
    const bIsNew = b.reps === 0;
    if (aIsNew !== bIsNew) return aIsNew ? -1 : 1;

    return a.due - b.due;
  });

  m.innerHTML = `<div class="small" style="margin:6px 4px 12px">${esc(currentPack)} · ${cards.length} groups</div>` +
    sorted.map((c, idx) => {
      const words = c.groups.flat();
      const days = Math.max(0, Math.round((c.due - Date.now()) / DAY));
      const dueTxt = c.due <= Date.now() ? (c.reps ? 'due' : 'new') : `in ${days}d`;
      const firstWord = c.groups[0] && c.groups[0][0] ? disp(c.groups[0][0]) : 'Word';

      let frontText, backText;
      if (studyMode === 'mode1') {
        frontText = firstWord;
        const def = c.definition ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--line)"><strong>Definition:</strong> ${esc(c.definition)}</div>${c.example ? `<div style="margin-top:6px;font-style:italic;color:var(--muted)">"${esc(c.example)}"</div>` : ''}` : '';
        backText = `<div style="margin-bottom:8px"><strong>Thai:</strong> ${esc(c.th)}</div><div style="margin-bottom:8px"><strong>Synonyms:</strong> ${words.map(w => esc(disp(w))).join(', ')}</div>${def}`;
      } else if (studyMode === 'mode2') {
        frontText = c.th;
        const def = c.definition ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--line)"><strong>Definition:</strong> ${esc(c.definition)}</div>${c.example ? `<div style="margin-top:6px;font-style:italic;color:var(--muted)">"${esc(c.example)}"</div>` : ''}` : '';
        backText = `<div style="margin-bottom:8px"><strong>English:</strong> ${words.map(w => esc(disp(w))).join(', ')}</div>${def}`;
      } else if (studyMode === 'mode3') {
        frontText = firstWord;
        const example = c.example ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--line)"><strong>Example:</strong><div style="margin-top:4px;font-style:italic;color:var(--muted)">"${esc(c.example)}"</div></div>` : '';
        backText = `<div style="margin-bottom:8px"><strong>Definition:</strong> ${esc(c.definition || c.th)}</div><div style="margin-bottom:8px"><strong>Similar:</strong> ${words.map(w => esc(disp(w))).join(', ')}</div>${example}`;
      }

      return `<div class="concept" onclick="toggleWordDef(${idx})">
        <div class="ch"><div class="cth">${esc(frontText)} <span class="cpos">${esc(c.pos)}</span></div>
          <div class="due">${dueTxt}</div></div>
        <div class="cw" id="words-${idx}" style="cursor:pointer;display:block">${esc(frontText)}</div>
        <div id="def-${idx}" style="display:none;margin-top:8px;padding:8px;background:var(--card2);border-radius:8px;font-size:13px;color:var(--muted);line-height:1.6">${backText}</div>
      </div>`;
    }).join('');
}

function toggleWordDef(idx) {
  const defEl = document.getElementById('def-' + idx);
  const wordsEl = document.getElementById('words-' + idx);
  const isHidden = defEl.style.display === 'none';

  defEl.style.display = isHidden ? 'block' : 'none';
  wordsEl.style.display = isHidden ? 'none' : 'block';
}

// ====== Init ======
render();
