/* ============================================================
   星噬 · 黑洞吞噬（Singularity）— 游戏引擎
   引力牵引 · 吞噬成长 · 与 AI 黑洞竞逐
   ============================================================ */
(() => {
'use strict';

/* ---------------- 配置 ---------------- */
const ROUND_TIME = 90;          // 一局秒数
const BODY_TARGET = 14;         // 环境天体目标数量
const BODY_SPAWN_EVERY = 2;     // 天体补充间隔（秒）
const AI_COUNT = 3;             // AI 黑洞数量
const AI_RESPAWN = 5;           // AI 重生间隔（秒）
const START_R = 15;             // 玩家初始半径
const GRAV_R = 320;             // 天体受黑洞引力影响半径
const GRAV_G = 50000;           // 引力强度（弱引力：鼓励主动狩猎，而非自动喂食）
const GRAV_CAP = 400;           // 天体受引力最大加速度
const INVULN_TIME = 3;          // 玩家出生保护（秒）
const DRAG_ACC = 1600;          // 牵引加速度 px/s²
const NUDGE_ACC = 650;          // 键盘微推加速度
const MAX_SPEED = 440;          // 速度上限
const FRICTION = 2.1;           // 摩擦系数 /s
const K_R = 1.5;                // 半径 = sqrt(mass) * K_R
const ABSORB_RATIO = 1.08;      // 可吞噬比例
const CRUSH_RATIO = 0.92;       // 被撕裂比例
const TAU = Math.PI * 2;
const KEY_BEST = 'singularity-best-mass';

const NUDGE_KEYS = {
  ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
  a: { x: -1, y: 0 }, d: { x: 1, y: 0 }, w: { x: 0, y: -1 }, s: { x: 0, y: 1 },
  A: { x: -1, y: 0 }, D: { x: 1, y: 0 }, W: { x: 0, y: -1 }, S: { x: 0, y: 1 },
};

/* ---------------- DOM ---------------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const elMass = document.getElementById('mass');
const elRank = document.getElementById('rank');
const elBest = document.getElementById('best');
const elMenuBest = document.getElementById('menuBest');
const elOverBest = document.getElementById('overBest');
const elFinal = document.getElementById('finalMass');
const elOverRank = document.getElementById('overRank');
const elOverTitle = document.getElementById('overTitle');
const elNewRecord = document.getElementById('newRecord');
const elToast = document.getElementById('toast');
const elTimerBar = document.getElementById('timerBar');
const menuEl = document.getElementById('menu');
const pauseEl = document.getElementById('pause');
const overEl = document.getElementById('over');
const muteBtn = document.getElementById('muteBtn');
const pauseBtn = document.getElementById('pauseBtn');
const startBtn = document.getElementById('startBtn');
const resumeBtn = document.getElementById('resumeBtn');
const restartBtn = document.getElementById('restartBtn');
const menuBtn = document.getElementById('menuBtn');

/* ---------------- 状态 ---------------- */
let state = 'menu';          // menu | playing | paused | dying | over
let demo = true;
let holes = [], bodies = [], particles = [];
let player = null;
let timer = ROUND_TIME;
let best = parseInt(localStorage.getItem(KEY_BEST) || '0', 10) || 0;
let muted = localStorage.getItem('singularity-muted') === '1';
let overReason = 'crushed';
let drag = null, dragging = false;
const keys = new Set();
let respawnQueue = [];
let spawnTimer = 1;
let nextMilestone = 250;
let invuln = 0;                 // 玩家出生保护剩余秒数
let shake = 0, eatFlash = 0, overShown = false;
let time = 0, last = performance.now();

/* ---------------- 尺寸 ---------------- */
let W = 0, H = 0, cell = 1;

function resize() {
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 10) return;
  W = rect.width;
  H = rect.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cell = Math.max(W, H) / 24;
}

/* ---------------- 星空数据 ---------------- */
const nebulae = [
  { x: 0.2, y: 0.25, r: 0.6, c: '104,90,220', sx: 0.005, sy: 0.004 },
  { x: 0.8, y: 0.72, r: 0.52, c: '30,120,190', sx: -0.005, sy: 0.005 },
  { x: 0.5, y: 0.12, r: 0.42, c: '200,70,160', sx: 0.004, sy: 0.006 },
  { x: 0.28, y: 0.88, r: 0.46, c: '50,180,170', sx: -0.004, sy: -0.004 },
];
const stars = Array.from({ length: 120 }, () => ({
  x: Math.random(), y: Math.random(),
  r: Math.random() < 0.1 ? 1.5 + Math.random() * 1.3 : 0.6 + Math.random() * 1,
  a: 0.25 + Math.random() * 0.6,
  tw: 0.5 + Math.random() * 2,
  ph: Math.random() * TAU,
}));

/* ---------------- 音频 ---------------- */
let actx = null, master = null;

function ensureAudio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    master = actx.createGain();
    master.gain.value = muted ? 0 : 0.45;
    master.connect(actx.destination);
  }
  if (actx.state === 'suspended') actx.resume();
}

function tone({ freq = 440, dur = 0.15, type = 'sine', vol = 0.25, delay = 0, slide = 0 }) {
  if (!actx || !master) return;
  const t0 = actx.currentTime + delay;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.03);
}

function playAbsorb() {
  tone({ freq: 440, dur: 0.08, vol: 0.16, slide: 660 });
  tone({ freq: 660, dur: 0.1, vol: 0.12, delay: 0.05, slide: 880 });
}
function playMilestone() {
  [392, 523, 659, 784].forEach((f, i) => tone({ freq: f, dur: 0.13, vol: 0.16, delay: i * 0.08 }));
}
function playEatAI() {
  tone({ freq: 200, dur: 0.35, type: 'sawtooth', vol: 0.16, slide: 600 });
  [523, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.16, vol: 0.15, delay: 0.1 + i * 0.09 }));
}
function playDie() {
  tone({ freq: 220, dur: 0.55, type: 'sawtooth', vol: 0.2, slide: 38 });
  tone({ freq: 110, dur: 0.7, vol: 0.16, delay: 0.08, slide: 30 });
}
function playStart() {
  [262, 392, 523].forEach((f, i) => tone({ freq: f, dur: 0.12, vol: 0.15, delay: i * 0.07 }));
}

/* ---------------- 工具 ---------------- */
function show(el, v) {
  el.classList.toggle('hidden', !v);
  if (v) {
    el.classList.remove('enter');
    void el.offsetWidth;
    el.classList.add('enter');
  }
}

let toastTimer = null;
function showToast(msg) {
  elToast.textContent = msg;
  elToast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elToast.classList.add('hidden'), 1800);
}

function rand(a, b) { return a + Math.random() * (b - a); }

function fmtMass(m) {
  if (m >= 10000) return (m / 10000).toFixed(1) + '万';
  if (m >= 1000) return (m / 1000).toFixed(1) + 'k';
  return Math.round(m) + '';
}

/* ---------------- 实体 ---------------- */
function makeHole(x, y, r, isPlayer, hue) {
  return { x, y, vx: 0, vy: 0, mass: r * r, r, isPlayer, hue, alive: true, diskAng: Math.random() * TAU };
}

function makeBody(x, y, r) {
  const t = Math.random();
  const type = t < 0.4 ? 'star' : t < 0.75 ? 'planet' : 'comet';
  const palettes = {
    star: [45, 60], planet: [190, 40, 45], comet: [170],
  };
  return {
    x, y, vx: rand(-30, 30), vy: rand(-30, 30), r, mass: r * r, type,
    hue: palettes[type][(Math.random() * palettes[type].length) | 0],
    hue2: Math.random() * 60 + 200,
  };
}

/** 生成一个与所有存活黑洞保持安全距离的天体位置 */
function safeBodySpot(minDist) {
  let x = 0, y = 0, tries = 0;
  do {
    x = rand(40, W - 40);
    y = rand(40, H - 40);
    tries++;
  } while (tries < 30 && holes.some(h => h.alive && Math.hypot(h.x - x, h.y - y) < minDist));
  return { x, y };
}

function initEntities() {
  holes = [];
  bodies = [];
  particles.length = 0;
  respawnQueue = [];
  spawnTimer = 1;
  nextMilestone = 250;
  const cx = W / 2, cy = H / 2;
  holes.push(makeHole(cx - 90, cy, START_R, true, 285));
  for (let i = 0; i < AI_COUNT; i++) {
    const ang = (i / AI_COUNT) * TAU + 0.6;
    holes.push(makeHole(cx + Math.cos(ang) * 200, cy + Math.sin(ang) * 200, 11 + Math.random() * 3.5, false, [190, 330, 45][i]));
  }
  for (let i = 0; i < BODY_TARGET; i++) {
    const spot = safeBodySpot(170);
    bodies.push(makeBody(spot.x, spot.y, rand(6, 26)));
  }
  player = holes[0];
}

function spawnBody() {
  const spot = safeBodySpot(150);
  bodies.push(makeBody(spot.x, spot.y, rand(6, 26)));
}

/* ---------------- 物理 ---------------- */
function moveHole(h, dt) {
  h.vx *= Math.max(0, 1 - FRICTION * dt);
  h.vy *= Math.max(0, 1 - FRICTION * dt);
  const sp = Math.hypot(h.vx, h.vy);
  if (sp > MAX_SPEED) { h.vx *= MAX_SPEED / sp; h.vy *= MAX_SPEED / sp; }
  h.x += h.vx * dt;
  h.y += h.vy * dt;
  const m = h.r;
  if (h.x < m) { h.x = m; h.vx = Math.abs(h.vx) * 0.5; }
  if (h.x > W - m) { h.x = W - m; h.vx = -Math.abs(h.vx) * 0.5; }
  if (h.y < m) { h.y = m; h.vy = Math.abs(h.vy) * 0.5; }
  if (h.y > H - m) { h.y = H - m; h.vy = -Math.abs(h.vy) * 0.5; }
}

function aiSteer(h, dt) {
  let danger = null, dangerD = Infinity;
  let target = null, bestD = Infinity;
  for (const o of holes) {
    if (o === h || !o.alive) continue;
    const d = Math.hypot(o.x - h.x, o.y - h.y);
    if (o.r > h.r * 1.2 && d < 260 && d < dangerD) { danger = o; dangerD = d; }
    if (o.r < h.r * 0.9 && d < bestD) { bestD = d; target = o; }
  }
  for (const b of bodies) {
    if (b.r >= h.r * 0.95) continue;
    const d = Math.hypot(b.x - h.x, b.y - h.y);
    if (d < bestD) { bestD = d; target = b; }
  }
  let tx = h.x, ty = h.y;
  if (danger) {
    const dx = h.x - danger.x, dy = h.y - danger.y;
    const d = Math.hypot(dx, dy) || 1;
    tx = h.x + dx / d * 300; ty = h.y + dy / d * 300;
  } else if (target) {
    tx = target.x; ty = target.y;
  } else if (Math.random() < 0.01) {
    h.wx = rand(60, W - 60); h.wy = rand(60, H - 60);
    tx = h.wx; ty = h.wy;
  }
  const dx = tx - h.x, dy = ty - h.y;
  const d = Math.hypot(dx, dy) || 1;
  const acc = demo ? 850 : 800;
  h.vx += dx / d * acc * dt;
  h.vy += dy / d * acc * dt;
}

function updateBodies(dt) {
  for (const b of bodies) {
    b.vx *= Math.max(0, 1 - 0.4 * dt);
    b.vy *= Math.max(0, 1 - 0.4 * dt);
    if (Math.random() < 0.6 * dt) {
      b.vx += (Math.random() - 0.5) * 120 * dt;
      b.vy += (Math.random() - 0.5) * 120 * dt;
    }
    let nh = null, nd = Infinity;
    for (const h of holes) {
      if (!h.alive) continue;
      const d = Math.hypot(h.x - b.x, h.y - b.y);
      if (d < GRAV_R && d < nd) { nd = d; nh = h; }
    }
    if (nh) {
      const d = Math.max(nd, 24);
      let f = GRAV_G * nh.mass / (d * d);
      f = Math.min(f, GRAV_CAP);
      b.vx += (nh.x - b.x) / d * f * dt;
      b.vy += (nh.y - b.y) / d * f * dt;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.5; }
    if (b.x > W - b.r) { b.x = W - b.r; b.vx = -Math.abs(b.vx) * 0.5; }
    if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy) * 0.5; }
    if (b.y > H - b.r) { b.y = H - b.r; b.vy = -Math.abs(b.vy) * 0.5; }
  }
}

/* ---------------- 吞噬与摧毁 ---------------- */
function absorb(h, b) {
  const i = bodies.indexOf(b);
  if (i >= 0) bodies.splice(i, 1);
  h.mass += b.mass;
  h.r = Math.sqrt(h.mass) * K_R;
  if (h.isPlayer) onPlayerAbsorb(h, b);
  swirlInto(h, b);
}

function onPlayerAbsorb(h, b) {
  playAbsorb();
  eatFlash = Math.max(eatFlash, 0.6);
  updateHud(true);
  if (h.mass >= nextMilestone) {
    showToast('✦ 质变 · 质量 ' + fmtMass(h.mass));
    playMilestone();
    burst(h.x, h.y, 26, 285);
    nextMilestone *= 2.2;
  }
}

function destroyHole(h) {
  if (!h.alive) return;
  if (h.isPlayer && invuln > 0) return;   // 出生保护
  h.alive = false;
  explode(h);
  if (h.isPlayer) {
    if (demo) {
      respawnQueue.push({ t: 2, isPlayer: true });
    } else {
      die();
    }
  } else {
    respawnQueue.push({ t: AI_RESPAWN, isPlayer: false });
  }
}

function eatHole(a, b) {
  if (!a.alive || !b.alive) return;
  const bIsPlayer = b.isPlayer;
  const aIsPlayer = a.isPlayer;
  a.mass += b.mass;
  b.alive = false;
  if (bIsPlayer) {
    explode(b);
    if (aIsPlayer) { /* 不可能：自己吃自己 */ }
    if (demo) {
      respawnQueue.push({ t: 2, isPlayer: true });
    } else {
      die();
    }
    return;
  }
  if (aIsPlayer) {
    a.mass += b.mass * 2;
    a.r = Math.sqrt(a.mass) * K_R;
    showToast('⚡ 吞噬对手黑洞！+' + fmtMass(b.mass * 2));
    playEatAI();
    eatFlash = 1;
    burst(a.x, a.y, 40, 285);
  }
  explode(b);
  respawnQueue.push({ t: AI_RESPAWN, isPlayer: false });
}

function collideAll() {
  // 黑洞 × 天体
  for (const h of holes) {
    if (!h.alive) continue;
    for (let i = bodies.length - 1; i >= 0; i--) {
      const b = bodies[i];
      const dx = b.x - h.x, dy = b.y - h.y;
      const d = Math.hypot(dx, dy);
      if (d > h.r + b.r) continue;
      if (h.r >= b.r * ABSORB_RATIO) {
        absorb(h, b);
      } else if (h.r < b.r * CRUSH_RATIO && !(h.isPlayer && invuln > 0)) {
        destroyHole(h);
        break;
      } else {
        const push = (h.r + b.r - d) / 2 + 1;
        const nx = dx / d, ny = dy / d;
        h.x -= nx * push; h.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
      }
    }
  }
  // 黑洞 × 黑洞
  for (let i = 0; i < holes.length; i++) {
    const a = holes[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < holes.length; j++) {
      const b = holes[j];
      if (!b.alive) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d > a.r + b.r || d === 0) continue;
      if (a.r >= b.r * ABSORB_RATIO && !(b.isPlayer && invuln > 0)) eatHole(a, b);
      else if (b.r >= a.r * ABSORB_RATIO && !(a.isPlayer && invuln > 0)) eatHole(b, a);
      else {
        const push = (a.r + b.r - d) / 2 + 1;
        const nx = dx / d, ny = dy / d;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
      }
    }
  }
}

/* ---------------- 流程 ---------------- */
function step(dt) {
  if (!demo && state === 'playing') {
    timer -= dt;
    invuln = Math.max(0, invuln - dt);
    if (timer <= 0) { timer = 0; endRound('time'); return; }
    elTimerBar.style.width = (timer / ROUND_TIME * 100).toFixed(1) + '%';
  }

  // 玩家操控
  const p = player;
  if (!demo && state === 'playing' && p && p.alive) {
    let ax = 0, ay = 0;
    if (drag) {
      const dx = drag.x - p.x, dy = drag.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const f = Math.min(1, d / 50);
      ax = dx / d * DRAG_ACC * f;
      ay = dy / d * DRAG_ACC * f;
    }
    for (const k of keys) {
      const n = NUDGE_KEYS[k];
      if (n) { ax += n.x * NUDGE_ACC; ay += n.y * NUDGE_ACC; }
    }
    p.vx += ax * dt;
    p.vy += ay * dt;
  }

  // 所有黑洞移动
  for (const h of holes) {
    if (!h.alive) continue;
    if (h.isPlayer && !demo && state === 'playing') {
      moveHole(h, dt);
    } else if (h.isPlayer && demo) {
      aiSteer(h, dt);
      moveHole(h, dt);
    } else {
      aiSteer(h, dt);
      moveHole(h, dt);
    }
  }

  updateBodies(dt);
  collideAll();

  // 补充天体
  if (bodies.length < BODY_TARGET) {
    spawnTimer -= dt;
    if (spawnTimer <= 0) { spawnBody(); spawnTimer = BODY_SPAWN_EVERY; }
  }

  // AI / 玩家重生
  for (let i = respawnQueue.length - 1; i >= 0; i--) {
    const e = respawnQueue[i];
    e.t -= dt;
    if (e.t <= 0) {
      respawnQueue.splice(i, 1);
      const r = 11 + Math.random() * 3.5;
      const h = makeHole(rand(50, W - 50), rand(50, H - 50), e.isPlayer ? START_R : r, !!e.isPlayer, e.isPlayer ? 285 : [190, 330, 45][Math.floor(Math.random() * 3)]);
      holes.push(h);
      if (e.isPlayer) player = h;
    }
  }
}

function computeRank() {
  const sorted = [...holes].filter(h => h.alive).sort((a, b) => b.mass - a.mass);
  const idx = sorted.findIndex(h => h.isPlayer);
  return idx < 0 ? 4 : idx + 1;
}

function die() {
  if (state !== 'playing') return;
  state = 'dying';
  overReason = 'crushed';
  shake = 18;
  explode(player);
  playDie();
  setTimeout(() => {
    if (state !== 'dying') return;
    state = 'over';
    showOver();
  }, 1000);
}

function endRound(reason) {
  if (state === 'over') return;
  overReason = reason;
  state = 'over';
  showOver();
}

function showOver() {
  if (overShown) return;
  overShown = true;
  const rank = computeRank();
  const mass = player ? player.mass : 0;
  const isRecord = mass > best;
  if (isRecord) {
    best = Math.round(mass);
    try { localStorage.setItem(KEY_BEST, String(best)); } catch (e) { /* 忽略 */ }
  }
  elFinal.textContent = fmtMass(mass);
  elOverRank.textContent = rank === 1 ? '👑 第 1 名 · 主宰星海' : '第 ' + rank + ' 名';
  elOverBest.textContent = fmtMass(best);
  elNewRecord.classList.toggle('hidden', !isRecord);
  elOverTitle.textContent = overReason === 'time' ? '时间到' : '被撕裂了';
  show(overEl, true);
  updateHud();
}

function startGame() {
  ensureAudio();
  demo = false;
  overShown = false;
  initEntities();
  timer = ROUND_TIME;
  invuln = INVULN_TIME;
  state = 'playing';
  updateHud(true);
  elTimerBar.style.width = '100%';
  show(menuEl, false);
  show(pauseEl, false);
  show(overEl, false);
  playStart();
}

function showMenu() {
  demo = true;
  initEntities();
  state = 'menu';
  updateHud();
  elMenuBest.textContent = fmtMass(best);
  show(overEl, false);
  show(pauseEl, false);
  show(menuEl, true);
}

function setPaused(v) {
  if (state === 'playing' && v) {
    state = 'paused';
    show(pauseEl, true);
  } else if (state === 'paused' && !v) {
    state = 'playing';
    show(pauseEl, false);
    last = performance.now();
  }
}

function updateHud(popScore) {
  if (!player) return;
  elMass.textContent = fmtMass(player.mass);
  elBest.textContent = fmtMass(best);
  const rank = computeRank();
  elRank.textContent = rank === 1 ? '👑1/4' : rank + '/4';
  if (popScore) {
    elMass.classList.remove('pop');
    void elMass.offsetWidth;
    elMass.classList.add('pop');
  }
}

/* ---------------- 粒子 ---------------- */
function burst(x, y, n, hueBase) {
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * TAU;
    const sp = (1.5 + Math.random() * 3.5) * cell;
    particles.push({
      kind: 'spark',
      x, y,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      life: 0, max: 0.6 + Math.random() * 0.7,
      size: cell * (0.06 + Math.random() * 0.12),
      hue: hueBase + Math.random() * 50 - 25,
    });
  }
  particles.push({ kind: 'ring', x, y, r: cell * 0.2, vr: cell * 4, life: 0, max: 0.5, hue: hueBase });
}

function swirlInto(h, b) {
  for (let i = 0; i < 14; i++) {
    const ang = Math.random() * TAU;
    particles.push({
      kind: 'swirl',
      x: b.x, y: b.y,
      tx: h.x, ty: h.y,
      ang, speed: 6 + Math.random() * 8,
      r0: Math.hypot(b.x - h.x, b.y - h.y),
      life: 0, max: 0.5 + Math.random() * 0.3,
      size: cell * (0.08 + Math.random() * 0.1),
      hue: b.hue || 45,
    });
  }
}

function explode(h) {
  burst(h.x, h.y, 22, h.hue || 285);
  particles.push({ kind: 'ring', x: h.x, y: h.y, r: h.r * 0.3, vr: cell * 6, life: 0, max: 0.7, hue: h.hue || 285 });
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += dt;
    if (p.life >= p.max) { particles.splice(i, 1); continue; }
    if (p.kind === 'spark') {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= Math.max(0, 1 - dt * 1.5);
      p.vy *= Math.max(0, 1 - dt * 0.7);
    } else if (p.kind === 'ring') {
      p.r += p.vr * dt;
      p.vr *= Math.max(0, 1 - dt * 1.6);
    } else if (p.kind === 'swirl') {
      p.ang += p.speed * dt;
      p.r0 *= Math.max(0, 1 - dt * 5.5);
      p.x = p.tx + Math.cos(p.ang) * p.r0;
      p.y = p.ty + Math.sin(p.ang) * p.r0;
    }
  }
}

/* ---------------- 绘制 ---------------- */
function drawSpace() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0b0f2e');
  g.addColorStop(0.5, '#120e33');
  g.addColorStop(1, '#08081c');
  ctx.fillStyle = g;
  ctx.fillRect(-40, -40, W + 80, H + 80);
  for (const nb of nebulae) {
    const nx = (((nb.x + time * nb.sx) % 1.2) + 1.2) % 1.2 - 0.1;
    const ny = (((nb.y + time * nb.sy) % 1.2) + 1.2) % 1.2 - 0.1;
    const px = nx * W, py = ny * H, pr = nb.r * Math.max(W, H);
    const ng = ctx.createRadialGradient(px, py, 0, px, py, pr);
    ng.addColorStop(0, `rgba(${nb.c},0.15)`);
    ng.addColorStop(1, `rgba(${nb.c},0)`);
    ctx.fillStyle = ng;
    ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
  }
  for (const st of stars) {
    const a = st.a * (0.55 + 0.45 * Math.sin(time * st.tw + st.ph));
    ctx.fillStyle = `rgba(230,240,255,${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(st.x * W, st.y * H, st.r, 0, TAU);
    ctx.fill();
  }
}

function drawBody(b) {
  const bx = b.x, by = b.y;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  if (b.type === 'star') {
    const g = ctx.createRadialGradient(bx, by, 0, bx, by, b.r * 3);
    g.addColorStop(0, `hsla(${b.hue},95%,75%,0.5)`);
    g.addColorStop(1, `hsla(${b.hue},95%,70%,0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(bx, by, b.r * 3, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(bx, by, b.r, 0, TAU); ctx.fill();
    ctx.fillStyle = `hsla(${b.hue},95%,80%,0.9)`;
    ctx.beginPath(); ctx.arc(bx, by, b.r * 0.7, 0, TAU); ctx.fill();
  } else if (b.type === 'planet') {
    ctx.fillStyle = `hsl(${b.hue},60%,55%)`;
    ctx.beginPath(); ctx.arc(bx, by, b.r, 0, TAU); ctx.fill();
    ctx.strokeStyle = `hsla(${b.hue2},80%,70%,0.7)`;
    ctx.lineWidth = Math.max(1.5, b.r * 0.18);
    ctx.beginPath(); ctx.ellipse(bx, by, b.r * 1.5, b.r * 0.45, -0.4, 0, TAU); ctx.stroke();
    ctx.fillStyle = `rgba(255,255,255,0.25)`;
    ctx.beginPath(); ctx.arc(bx - b.r * 0.3, by - b.r * 0.3, b.r * 0.45, 0, TAU); ctx.fill();
  } else {
    const sp = Math.hypot(b.vx, b.vy) || 1;
    const tx = bx - b.vx / sp * b.r * 3, ty = by - b.vy / sp * b.r * 3;
    const g = ctx.createLinearGradient(tx, ty, bx, by);
    g.addColorStop(0, `hsla(${b.hue},95%,70%,0)`);
    g.addColorStop(1, `hsla(${b.hue},95%,75%,0.85)`);
    ctx.strokeStyle = g;
    ctx.lineWidth = Math.max(1.5, b.r * 0.5);
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(bx, by); ctx.stroke();
    ctx.fillStyle = `hsla(${b.hue},95%,80%,0.95)`;
    ctx.beginPath(); ctx.arc(bx, by, b.r, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

function drawHole(h) {
  const { x, y, r } = h;
  ctx.save();
  // 外辉光
  const glow = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 3.2);
  glow.addColorStop(0, `hsla(${h.hue},85%,60%,0.28)`);
  glow.addColorStop(1, `hsla(${h.hue},85%,60%,0)`);
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(x, y, r * 3.2, 0, TAU); ctx.fill();

  // 吸积盘（旋转椭圆环）
  h.diskAng += 0.9 * (0.8 + Math.min(r / 30, 2)) / 60 * (60 / 60);
  ctx.translate(x, y);
  ctx.rotate(h.diskAng);
  const rr = r * 2.1;
  const disk = ctx.createLinearGradient(0, -rr, 0, rr);
  disk.addColorStop(0, 'rgba(255,120,80,0.85)');
  disk.addColorStop(0.5, 'rgba(255,190,90,0.55)');
  disk.addColorStop(1, 'rgba(167,90,255,0.85)');
  ctx.fillStyle = disk;
  ctx.beginPath();
  ctx.ellipse(0, 0, rr, r * 0.72, 0, 0, TAU);
  ctx.fill();
  // 亮环边
  ctx.strokeStyle = 'rgba(255,235,200,0.9)';
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.beginPath();
  ctx.ellipse(0, 0, rr, r * 0.72, 0, 0, TAU);
  ctx.stroke();

  ctx.rotate(-h.diskAng);
  // 事件视界（纯黑核）
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(0, 0, r * 0.92, 0, TAU); ctx.fill();
  // 核心微光边缘
  ctx.strokeStyle = `hsla(${h.hue},90%,75%,0.9)`;
  ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.beginPath(); ctx.arc(0, 0, r * 0.92, 0, TAU); ctx.stroke();
  ctx.restore();

  // 玩家标记眼睛（小亮点）
  if (h.isPlayer) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.arc(x, y, Math.max(2, r * 0.1), 0, TAU); ctx.fill();
    // 出生保护光环
    if (invuln > 0 && state === 'playing') {
      const pr = r * 2.2 + Math.sin(time * 6) * r * 0.3;
      ctx.strokeStyle = `rgba(125,211,252,${(0.35 + 0.25 * Math.sin(time * 6)).toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, pr, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(125,211,252,0.15)';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(x, y, pr + 5, 0, TAU); ctx.stroke();
    }
  }
}

function drawDragHint() {
  if (!drag || !player) return;
  const px = player.x, py = player.y;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // 牵引线
  ctx.strokeStyle = 'rgba(167,139,250,0.35)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 8]);
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(drag.x, drag.y); ctx.stroke();
  ctx.setLineDash([]);
  // 指针处引力波纹
  for (let k = 0; k < 2; k++) {
    const ph = (time * 2 + k * 0.5) % 1;
    ctx.strokeStyle = `rgba(167,139,250,${(0.4 * (1 - ph)).toFixed(3)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(drag.x, drag.y, 8 + ph * 34, 0, TAU); ctx.stroke();
  }
  ctx.restore();
}

function drawParticles() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of particles) {
    const k = 1 - p.life / p.max;
    if (p.kind === 'spark' || p.kind === 'swirl') {
      ctx.fillStyle = `hsla(${p.hue},95%,72%,${(k * 0.9).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.5 + k), 0, TAU); ctx.fill();
    } else {
      ctx.strokeStyle = `hsla(${p.hue},95%,70%,${(k * 0.8).toFixed(3)})`;
      ctx.lineWidth = Math.max(1.5, cell * 0.07 * k + 1);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.stroke();
    }
  }
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (shake > 0.4) {
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    shake *= 0.88;
  }
  drawSpace();
  for (const b of bodies) drawBody(b);
  for (const h of holes) if (h.alive) drawHole(h);
  drawDragHint();
  drawParticles();
  if (eatFlash > 0.02) {
    ctx.fillStyle = `rgba(255,230,200,${(eatFlash * 0.12).toFixed(3)})`;
    ctx.fillRect(-40, -40, W + 80, H + 80);
    eatFlash *= 0.9;
  }
  ctx.restore();
}

/* ---------------- 输入 ---------------- */
function posFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

canvas.addEventListener('pointerdown', (e) => {
  ensureAudio();
  drag = posFromEvent(e);
  dragging = true;
  if (state === 'menu' || state === 'over') startGame();
});
window.addEventListener('pointermove', (e) => {
  if (dragging) drag = posFromEvent(e);
});
window.addEventListener('pointerup', () => { dragging = false; drag = null; });
window.addEventListener('pointercancel', () => { dragging = false; drag = null; });

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  ensureAudio();
  const t = e.changedTouches[0];
  drag = { x: t.clientX - canvas.getBoundingClientRect().left, y: t.clientY - canvas.getBoundingClientRect().top };
  dragging = true;
  if (state === 'menu' || state === 'over') startGame();
}, { passive: false });
window.addEventListener('touchmove', (e) => {
  if (!dragging) return;
  const t = e.changedTouches[0];
  drag = { x: t.clientX - canvas.getBoundingClientRect().left, y: t.clientY - canvas.getBoundingClientRect().top };
}, { passive: true });
window.addEventListener('touchend', () => { dragging = false; drag = null; });

window.addEventListener('keydown', (e) => {
  const k = e.key;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(k)) e.preventDefault();
  keys.add(k);
  if (k === ' ' || k === 'Enter') {
    if (state === 'menu' || state === 'over') startGame();
    else if (state === 'playing') setPaused(true);
    else if (state === 'paused') setPaused(false);
  } else if (k === 'p' || k === 'P' || k === 'Escape') {
    if (state === 'playing') setPaused(true);
    else if (state === 'paused') setPaused(false);
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key));

startBtn.addEventListener('click', startGame);
restartBtn.addEventListener('click', startGame);
menuBtn.addEventListener('click', showMenu);
resumeBtn.addEventListener('click', () => setPaused(false));
pauseBtn.addEventListener('click', () => setPaused(true));
muteBtn.addEventListener('click', () => {
  muted = !muted;
  try { localStorage.setItem('singularity-muted', muted ? '1' : '0'); } catch (e) { /* 忽略 */ }
  if (master) master.gain.value = muted ? 0 : 0.45;
  muteBtn.textContent = muted ? '🔇' : '🔊';
  ensureAudio();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') setPaused(true);
});

/* ---------------- 主循环 ---------------- */
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  time += dt;
  if (state === 'playing' || state === 'menu' || state === 'dying') {
    step(dt);
  }
  updateParticles(dt);
  draw();
}

/* ---------------- 调试钩子 ---------------- */
window.__gameDebug = () => ({
  state, demo,
  mass: player ? player.mass : 0,
  radius: player ? player.r : 0,
  timer: Math.max(0, timer),
  rank: computeRank(),
  best,
  holes: holes.filter(h => h.alive).length,
  holesList: holes.filter(h => h.alive).map(h => ({ x: h.x, y: h.y, r: h.r, isPlayer: h.isPlayer })),
  bodies: bodies.map(b => ({ x: b.x, y: b.y, r: b.r, type: b.type })),
  player: player ? { x: player.x, y: player.y, vx: player.vx, vy: player.vy } : null,
  invuln: Math.max(0, invuln),
  overReason,
});
window.__gameFastForward = (sec) => {
  if (!demo && state === 'playing') {
    timer -= sec;
    if (timer <= 0) { timer = 0; endRound('time'); }
  }
};
// 测试钩子：立即结束出生保护 / 在指定位置生成天体（生产环境无害）
window.__gameTest = {
  noInvuln() { invuln = 0; },
  spawnBodyAt(x, y, r) { bodies.push(makeBody(x, y, r)); },
};

/* ---------------- 初始化 ---------------- */
resize();
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
initEntities();
updateHud();
elMenuBest.textContent = fmtMass(best);
muteBtn.textContent = muted ? '🔇' : '🔊';
show(menuEl, true);
if (new URLSearchParams(location.search).has('autoplay')) startGame();
requestAnimationFrame(frame);

})();
