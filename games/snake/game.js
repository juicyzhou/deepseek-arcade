/* ============================================================
   流光 · 贪吃蛇  —  游戏引擎
   极光星海 × 流光丝带：平滑插值运动 · 粒子特效 · 合成音效
   ============================================================ */
(() => {
'use strict';

/* ---------------- 配置 ---------------- */
const COLS = 24, ROWS = 16;            // 网格
const BASE_TICK = 150;                 // 初始步进间隔 ms
const MIN_TICK = 75;                   // 最快步进
const TICK_STEP = 6;                   // 每级提速
const MENU_TICK = BASE_TICK + 70;      // 主菜单演示蛇速度
const START_LEN = 4;                   // 初始长度
const GROW = 1;                        // 每颗能量星增长格数
const POINTS = 10;                     // 基础得分
const FOODS_PER_LEVEL = 5;             // 升级所需能量星数
const TAU = Math.PI * 2;
const HUE0 = 195, HUE1 = 305;          // 蛇身头部→尾部色相（青→品红）
const KEY_BEST = 'aurora-snake-best';
const KEY_MUTED = 'aurora-snake-muted';

const KEYMAP = {
  ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
  w: { x: 0, y: -1 }, s: { x: 0, y: 1 }, a: { x: -1, y: 0 }, d: { x: 1, y: 0 },
  W: { x: 0, y: -1 }, S: { x: 0, y: 1 }, A: { x: -1, y: 0 }, D: { x: 1, y: 0 },
};

/* ---------------- DOM ---------------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const elScore = document.getElementById('score');
const elBest = document.getElementById('best');
const elLevel = document.getElementById('level');
const elMenuBest = document.getElementById('menuBest');
const elOverBest = document.getElementById('overBest');
const elFinal = document.getElementById('finalScore');
const elOverTitle = document.getElementById('overTitle');
const elNewRecord = document.getElementById('newRecord');
const elToast = document.getElementById('toast');
const menuEl = document.getElementById('menu');
const pauseEl = document.getElementById('pause');
const overEl = document.getElementById('over');
const wrapToggle = document.getElementById('wrapToggle');
const muteBtn = document.getElementById('muteBtn');
const pauseBtn = document.getElementById('pauseBtn');
const startBtn = document.getElementById('startBtn');
const resumeBtn = document.getElementById('resumeBtn');
const restartBtn = document.getElementById('restartBtn');
const menuBtn = document.getElementById('menuBtn');

/* ---------------- 状态 ---------------- */
let state = 'menu';            // menu | playing | paused | dying | over
let demo = true;               // 主菜单演示模式
let snake = [], prevSnake = [];
let dir = { x: 1, y: 0 }, dirQueue = [];
let food = null;
let score = 0, level = 1, foods = 0, growing = 0;
let tickMs = BASE_TICK, tickAcc = 0;
let wrap = false;
let best = parseInt(localStorage.getItem(KEY_BEST) || '0', 10) || 0;
let muted = localStorage.getItem(KEY_MUTED) === '1';
let particles = [];
let shake = 0, eatFlash = 0, frozenT = 0, trailTimer = 0;
let time = 0, last = performance.now();

/* ---------------- 尺寸 ---------------- */
let W = 0, H = 0, cell = 0;

function resize() {
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 10) return;
  W = rect.width;
  H = rect.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cell = W / COLS;
}

/* ---------------- 星空数据 ---------------- */
const nebulae = [
  { x: 0.18, y: 0.22, r: 0.55, c: '104,90,220',  sx: 0.006,  sy: 0.004 },
  { x: 0.82, y: 0.70, r: 0.50, c: '30,120,190',  sx: -0.005, sy: 0.005 },
  { x: 0.55, y: 0.10, r: 0.42, c: '200,70,160',  sx: 0.004,  sy: 0.006 },
  { x: 0.30, y: 0.85, r: 0.48, c: '50,180,170',  sx: -0.004, sy: -0.004 },
];
const stars = Array.from({ length: 130 }, () => ({
  x: Math.random(),
  y: Math.random(),
  r: Math.random() < 0.12 ? 1.6 + Math.random() * 1.4 : 0.6 + Math.random() * 1.1,
  a: 0.25 + Math.random() * 0.65,
  tw: 0.5 + Math.random() * 2.2,
  ph: Math.random() * TAU,
  vy: 0.01 + Math.random() * 0.02,
}));

/* ---------------- 音频（WebAudio 合成） ---------------- */
let actx = null, master = null;

function ensureAudio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    master = actx.createGain();
    master.gain.value = muted ? 0 : 0.5;
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

function playEat() {
  tone({ freq: 523, dur: 0.09, vol: 0.2 });
  tone({ freq: 784, dur: 0.12, vol: 0.16, delay: 0.05 });
}
function playLevel() {
  [392, 523, 659, 784].forEach((f, i) => tone({ freq: f, dur: 0.14, vol: 0.18, delay: i * 0.09 }));
}
function playDie() {
  tone({ freq: 320, dur: 0.5, type: 'sawtooth', vol: 0.22, slide: 52 });
  tone({ freq: 160, dur: 0.6, vol: 0.18, delay: 0.08, slide: 38 });
}
function playStart() {
  [262, 392, 523].forEach((f, i) => tone({ freq: f, dur: 0.12, vol: 0.16, delay: i * 0.07 }));
}

/* ---------------- 工具 ---------------- */
const lerp = (a, b, t) => a + (b - a) * t;
const hue = (f) => HUE0 + (HUE1 - HUE0) * f;

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
  toastTimer = setTimeout(() => elToast.classList.add('hidden'), 1600);
}

/* ---------------- 粒子 ---------------- */
function burst(x, y, n, hueBase) {
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * TAU;
    const sp = (1.5 + Math.random() * 3.5) * cell;
    particles.push({
      kind: 'spark',
      x: (x + 0.5) * cell,
      y: (y + 0.5) * cell,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      life: 0,
      max: 0.6 + Math.random() * 0.7,
      size: cell * (0.06 + Math.random() * 0.12),
      hue: hueBase + Math.random() * 40 - 20,
    });
  }
  particles.push({
    kind: 'ring',
    x: (x + 0.5) * cell,
    y: (y + 0.5) * cell,
    r: cell * 0.2,
    vr: cell * 3.2,
    life: 0,
    max: 0.5,
    hue: hueBase,
  });
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += dt;
    if (p.life >= p.max) { particles.splice(i, 1); continue; }
    if (p.kind === 'spark') {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += cell * 2.4 * dt;                 // 轻微下落
      p.vx *= Math.max(0, 1 - dt * 1.4);
      p.vy *= Math.max(0, 1 - dt * 0.6);
    } else {
      p.r += p.vr * dt;
      p.vr *= Math.max(0, 1 - dt * 1.5);
    }
  }
}

/* ---------------- 游戏逻辑 ---------------- */
function spawnFood() {
  const occupied = new Set(snake.map(s => s.x + ',' + s.y));
  const free = [];
  for (let x = 0; x < COLS; x++) {
    for (let y = 0; y < ROWS; y++) {
      if (!occupied.has(x + ',' + y)) free.push({ x, y });
    }
  }
  if (!free.length) { food = null; return false; }
  food = free[(Math.random() * free.length) | 0];
  return true;
}

function resetDemo() {
  const cx = (COLS / 2) | 0, cy = (ROWS / 2) | 0;
  snake = [];
  for (let i = 0; i < START_LEN; i++) snake.push({ x: cx - i, y: cy });
  prevSnake = snake.map(s => ({ ...s }));
  dir = { x: 1, y: 0 };
  dirQueue = [];
  growing = 0;
  spawnFood();
}

function step() {
  if (dirQueue.length) dir = dirQueue.shift();
  const head = snake[0];
  const nx = head.x + dir.x, ny = head.y + dir.y;
  let hx = nx, hy = ny;
  if (wrap && !demo) {
    hx = (nx + COLS) % COLS;
    hy = (ny + ROWS) % ROWS;
  } else if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) {
    if (demo) { resetDemo(); return; }
    die();
    return;
  }
  // 自碰检测（尾部即将移开，忽略最后一格）
  const body = snake.slice(0, -1);
  if (body.some(s => s.x === hx && s.y === hy)) {
    if (demo) { resetDemo(); return; }
    die();
    return;
  }
  prevSnake = snake.map(s => ({ x: s.x, y: s.y }));
  snake.unshift({ x: hx, y: hy });
  const ate = food !== null && hx === food.x && hy === food.y;
  if (ate) {
    if (demo) {
      burst(hx, hy, 14, 45);
    } else {
      growing += GROW;
      burst(hx, hy, 26, 45);
      score += POINTS * level;
      foods++;
      eatFlash = 1;
      playEat();
      if (foods % FOODS_PER_LEVEL === 0) levelUp();
      updateHud(true);
    }
    if (!spawnFood()) {
      if (demo) resetDemo(); else win();
      return;
    }
  } else {
    if (growing > 0) growing--; else snake.pop();
  }
}

function demoStep() {
  const head = snake[0];
  const occ = new Set(snake.slice(0, -1).map(s => s.x + ',' + s.y));
  const shuffled = [
    { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
  ].sort(() => Math.random() - 0.5);
  const tries = [dir, ...shuffled];
  for (const d of tries) {
    const nx = head.x + d.x, ny = head.y + d.y;
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
    if (d.x === -dir.x && d.y === -dir.y) continue;
    if (occ.has(nx + ',' + ny)) continue;
    dir = d;
    step();
    return;
  }
}

function die() {
  state = 'dying';
  shake = 16;
  frozenT = Math.min(1, tickAcc / tickMs);
  for (const s of snake) burst(s.x, s.y, 5, 285);
  burst(snake[0].x, snake[0].y, 34, 200);
  playDie();
  setTimeout(() => {
    if (state !== 'dying') return;
    state = 'over';
    const isRecord = score > best;
    if (isRecord) {
      best = score;
      try { localStorage.setItem(KEY_BEST, String(best)); } catch (e) { /* 忽略 */ }
    }
    elFinal.textContent = score;
    elOverBest.textContent = best;
    elNewRecord.classList.toggle('hidden', !isRecord);
    elOverTitle.textContent = '游戏结束';
    show(overEl, true);
    updateHud();
  }, 950);
}

function win() {
  state = 'over';
  const isRecord = score > best;
  if (isRecord) {
    best = score;
    try { localStorage.setItem(KEY_BEST, String(best)); } catch (e) { /* 忽略 */ }
  }
  elFinal.textContent = score;
  elOverBest.textContent = best;
  elNewRecord.classList.toggle('hidden', !isRecord);
  elOverTitle.textContent = '星河已满 · 通关！';
  show(overEl, true);
  updateHud();
  playLevel();
}

function levelUp() {
  level++;
  tickMs = Math.max(MIN_TICK, BASE_TICK - (level - 1) * TICK_STEP);
  burst(snake[0].x, snake[0].y, 30, 190);
  showToast('✦ 等级提升 · Lv.' + level + ' 加速！');
  playLevel();
}

function startGame() {
  ensureAudio();
  demo = false;
  wrap = wrapToggle.checked;
  const cx = (COLS / 2) | 0, cy = (ROWS / 2) | 0;
  snake = [];
  for (let i = 0; i < START_LEN; i++) snake.push({ x: cx - i, y: cy });
  prevSnake = snake.map(s => ({ ...s }));
  dir = { x: 1, y: 0 };
  dirQueue = [];
  score = 0; level = 1; foods = 0; growing = 0;
  tickMs = BASE_TICK; tickAcc = 0;
  frozenT = 0;
  particles.length = 0;
  shake = 0; eatFlash = 0; trailTimer = 0;
  spawnFood();
  state = 'playing';
  updateHud(true);
  show(menuEl, false);
  show(pauseEl, false);
  show(overEl, false);
  playStart();
}

function showMenu() {
  demo = true;
  resetDemo();
  state = 'menu';
  tickAcc = 0;
  updateHud();
  elMenuBest.textContent = best;
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
  elScore.textContent = score;
  elBest.textContent = best;
  elLevel.textContent = 'Lv.' + level;
  if (popScore) {
    elScore.classList.remove('pop');
    void elScore.offsetWidth;
    elScore.classList.add('pop');
  }
}

/* ---------------- 输入 ---------------- */
function queueDir(d) {
  const lastD = dirQueue.length ? dirQueue[dirQueue.length - 1] : dir;
  if (d.x === lastD.x && d.y === lastD.y) return;
  if (d.x === -lastD.x && d.y === -lastD.y) return;
  if (dirQueue.length < 2) dirQueue.push(d);
}

window.addEventListener('keydown', (e) => {
  const k = e.key;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(k)) e.preventDefault();
  const d = KEYMAP[k];
  if (d && state === 'playing') queueDir(d);
  if (k === ' ' || k === 'Enter') {
    if (state === 'menu' || state === 'over') startGame();
    else if (state === 'playing') setPaused(true);
    else if (state === 'paused') setPaused(false);
  } else if (k === 'p' || k === 'P' || k === 'Escape') {
    if (state === 'playing') setPaused(true);
    else if (state === 'paused') setPaused(false);
  }
});

let touch0 = null;
canvas.addEventListener('touchstart', (e) => {
  touch0 = e.touches[0];
}, { passive: true });

canvas.addEventListener('touchend', (e) => {
  if (!touch0) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touch0.clientX;
  const dy = t.clientY - touch0.clientY;
  touch0 = null;
  if (state === 'menu' || state === 'over') { startGame(); return; }
  if (state !== 'playing') return;
  if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
  const d = Math.abs(dx) > Math.abs(dy)
    ? (dx > 0 ? { x: 1, y: 0 } : { x: -1, y: 0 })
    : (dy > 0 ? { x: 0, y: 1 } : { x: 0, y: -1 });
  queueDir(d);
}, { passive: true });

canvas.addEventListener('click', () => {
  if (state === 'menu' || state === 'over') startGame();
});

startBtn.addEventListener('click', startGame);
restartBtn.addEventListener('click', startGame);
menuBtn.addEventListener('click', showMenu);
resumeBtn.addEventListener('click', () => setPaused(false));
pauseBtn.addEventListener('click', () => setPaused(true));
muteBtn.addEventListener('click', () => {
  muted = !muted;
  try { localStorage.setItem(KEY_MUTED, muted ? '1' : '0'); } catch (e) { /* 忽略 */ }
  if (master) master.gain.value = muted ? 0 : 0.5;
  muteBtn.textContent = muted ? '🔇' : '🔊';
  ensureAudio();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') setPaused(true);
});

/* ---------------- 绘制 ---------------- */
function drawSpace() {
  // 深空渐变
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0b0f2e');
  g.addColorStop(0.5, '#120e33');
  g.addColorStop(1, '#08081c');
  ctx.fillStyle = g;
  ctx.fillRect(-40, -40, W + 80, H + 80);
  // 星云
  for (const nb of nebulae) {
    const nx = (((nb.x + time * nb.sx) % 1.2) + 1.2) % 1.2 - 0.1;
    const ny = (((nb.y + time * nb.sy) % 1.2) + 1.2) % 1.2 - 0.1;
    const px = nx * W, py = ny * H;
    const pr = nb.r * Math.max(W, H);
    const ng = ctx.createRadialGradient(px, py, 0, px, py, pr);
    ng.addColorStop(0, `rgba(${nb.c},0.16)`);
    ng.addColorStop(1, `rgba(${nb.c},0)`);
    ctx.fillStyle = ng;
    ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
  }
  // 星星
  for (const st of stars) {
    const a = st.a * (0.55 + 0.45 * Math.sin(time * st.tw + st.ph));
    const sy = (st.y + time * st.vy * 0.05) % 1;
    ctx.fillStyle = `rgba(230,240,255,${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(st.x * W, sy * H, st.r, 0, TAU);
    ctx.fill();
    if (st.r > 2.2) {
      ctx.strokeStyle = `rgba(200,225,255,${(a * 0.4).toFixed(3)})`;
      ctx.lineWidth = 1;
      const l = st.r * 3.2;
      ctx.beginPath();
      ctx.moveTo(st.x * W - l, sy * H); ctx.lineTo(st.x * W + l, sy * H);
      ctx.moveTo(st.x * W, sy * H - l); ctx.lineTo(st.x * W, sy * H + l);
      ctx.stroke();
    }
  }
}

function drawGrid() {
  ctx.fillStyle = 'rgba(160,190,255,0.055)';
  const r = Math.max(1, cell * 0.045);
  for (let x = 0; x < COLS; x++) {
    for (let y = 0; y < ROWS; y++) {
      if ((x + y) % 2) continue;         // 棋盘格淡化，更透气
      ctx.beginPath();
      ctx.arc((x + 0.5) * cell, (y + 0.5) * cell, r, 0, TAU);
      ctx.fill();
    }
  }
}

function drawFood() {
  const fx = (food.x + 0.5) * cell, fy = (food.y + 0.5) * cell;
  const pulse = 1 + 0.16 * Math.sin(time * 4.5);
  const r = cell * 0.34 * pulse;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // 光晕
  const halo = ctx.createRadialGradient(fx, fy, 0, fx, fy, cell * 1.15);
  halo.addColorStop(0, 'rgba(255,214,120,0.5)');
  halo.addColorStop(1, 'rgba(255,120,170,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(fx, fy, cell * 1.15, 0, TAU);
  ctx.fill();
  // 核心
  const core = ctx.createRadialGradient(fx - r * 0.3, fy - r * 0.3, r * 0.1, fx, fy, r);
  core.addColorStop(0, '#fff7e8');
  core.addColorStop(0.45, '#ffd36e');
  core.addColorStop(1, '#ff6ba9');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(fx, fy, r, 0, TAU);
  ctx.fill();
  // 光环
  ctx.strokeStyle = `rgba(255,255,255,${(0.5 + 0.3 * Math.sin(time * 4.5)).toFixed(3)})`;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(fx, fy, r + 5 + 2.5 * Math.sin(time * 5), 0, TAU);
  ctx.stroke();
  // 环绕卫星
  for (let k = 0; k < 2; k++) {
    const a = time * 2.4 + k * Math.PI;
    const ox = fx + Math.cos(a) * cell * 0.62;
    const oy = fy + Math.sin(a) * cell * 0.62;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(ox, oy, cell * 0.05, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawSnake() {
  if (!snake.length) return;
  let t;
  if (state === 'playing') t = Math.min(1, tickAcc / tickMs);
  else if (state === 'menu') t = Math.min(1, tickAcc / MENU_TICK);
  else t = frozenT;
  const pts = snake.map((s, i) => {
    const p = prevSnake[i] || s;
    return { x: (lerp(p.x, s.x, t) + 0.5) * cell, y: (lerp(p.y, s.y, t) + 0.5) * cell };
  });
  const n = pts.length;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'lighter';
  // 外晕（柔光）
  for (let i = 1; i < n; i++) {
    const f = i / (n - 1);
    ctx.strokeStyle = `hsla(${hue(f)},95%,62%,${(0.16 - f * 0.08).toFixed(3)})`;
    ctx.lineWidth = cell * (0.95 - f * 0.4);
    ctx.beginPath();
    ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
    ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
  // 主体（青→品红渐变光带）
  for (let i = 1; i < n; i++) {
    const f = i / (n - 1);
    ctx.strokeStyle = `hsla(${hue(f)},95%,${(62 + f * 6).toFixed(0)}%,0.95)`;
    ctx.lineWidth = cell * (0.6 - f * 0.24);
    ctx.beginPath();
    ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
    ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
  // 蛇头
  const hp = pts[0];
  const hg = ctx.createRadialGradient(hp.x, hp.y, 0, hp.x, hp.y, cell * 0.9);
  hg.addColorStop(0, 'rgba(255,255,255,0.95)');
  hg.addColorStop(0.4, `hsl(${hue(0)},95%,74%)`);
  hg.addColorStop(1, 'rgba(120,80,255,0)');
  ctx.fillStyle = hg;
  ctx.shadowColor = 'hsl(200,95%,70%)';
  ctx.shadowBlur = 24;
  ctx.beginPath();
  ctx.arc(hp.x, hp.y, cell * 0.6, 0, TAU);
  ctx.fill();
  ctx.shadowBlur = 0;
  // 眼睛（随方向转向）
  const px = -dir.y, py = dir.x;
  for (const s of [-1, 1]) {
    const ex = hp.x + px * cell * 0.22 * s + dir.x * cell * 0.16;
    const ey = hp.y + py * cell * 0.22 * s + dir.y * cell * 0.16;
    ctx.fillStyle = 'rgba(8,10,36,0.92)';
    ctx.beginPath();
    ctx.arc(ex, ey, cell * 0.095, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(ex + dir.x * cell * 0.035, ey + dir.y * cell * 0.035, cell * 0.045, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawParticles() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of particles) {
    const k = 1 - p.life / p.max;
    if (p.kind === 'spark') {
      ctx.fillStyle = `hsla(${p.hue},95%,72%,${(k * 0.9).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.5 + k), 0, TAU);
      ctx.fill();
    } else {
      ctx.strokeStyle = `hsla(${p.hue},95%,70%,${(k * 0.8).toFixed(3)})`;
      ctx.lineWidth = Math.max(1.5, cell * 0.06 * k + 1);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.stroke();
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
  drawGrid();
  if (food) drawFood();
  drawSnake();
  drawParticles();
  if (eatFlash > 0.02) {
    ctx.fillStyle = `rgba(190,220,255,${(eatFlash * 0.1).toFixed(3)})`;
    ctx.fillRect(-40, -40, W + 80, H + 80);
    eatFlash *= 0.9;
  }
  ctx.restore();
}

/* ---------------- 主循环 ---------------- */
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  time += dt;

  if (state === 'playing') {
    tickAcc += dt * 1000;
    while (tickAcc >= tickMs) {
      tickAcc -= tickMs;
      step();
      if (state !== 'playing') break;
    }
    // 蛇头尾焰
    trailTimer += dt;
    if (trailTimer > 0.05) {
      trailTimer = 0;
      const hp = snake[0];
      particles.push({
        kind: 'spark',
        x: (hp.x + 0.5) * cell + (Math.random() - 0.5) * cell * 0.5,
        y: (hp.y + 0.5) * cell + (Math.random() - 0.5) * cell * 0.5,
        vx: (Math.random() - 0.5) * cell * 0.4,
        vy: (Math.random() - 0.5) * cell * 0.4,
        life: 0,
        max: 0.45,
        size: cell * 0.08,
        hue: 195 + Math.random() * 40,
      });
    }
  } else if (state === 'menu') {
    tickAcc += dt * 1000;
    while (tickAcc >= MENU_TICK) {
      tickAcc -= MENU_TICK;
      demoStep();
    }
  }

  updateParticles(dt);
  draw();
}

/* ---------------- 初始化 ---------------- */
resize();
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
resetDemo();
updateHud();
elMenuBest.textContent = best;
muteBtn.textContent = muted ? '🔇' : '🔊';
show(menuEl, true);
// 演示 / 截图模式：?autoplay 自动开局（并开启穿越模式，可无限游玩）
if (new URLSearchParams(location.search).has('autoplay')) {
  wrapToggle.checked = true;
  startGame();
}
// 调试钩子（供自动化测试 / 控制台检查使用）
window.__snakeDebug = () => ({
  state, demo, score, level, foods, growing,
  snake: snake.map(s => ({ ...s })),
  food: food ? { ...food } : null,
  dir: { ...dir },
});
requestAnimationFrame(frame);

})();
