/* ============================================================
   双身迷宫 · 时间幽灵（Ghost Echo）— 游戏引擎
   回声延迟机制：你的过去身以 2.6s 延迟复刻你的移动
   ============================================================ */
(() => {
'use strict';

/* ---------------- 配置 ---------------- */
const TICK = 0.13;               // 一步耗时（秒）
const DELAY_TICKS = 20;          // 回声延迟（2.6 秒）
const KEY_BEST = 'ghostecho-best';
const TAU = Math.PI * 2;

const rand = (a, b) => a + Math.random() * (b - a);

/* ---------------- 关卡数据 ---------------- */
const LEVELS = [
  { // L1 教学：收集宝石，走向出口
    rows: [
      'RRRRRRRRR',
      'R.S..G..R',
      'R.RRRRR.R',
      'R......ER',
      'RRRRRRRRR',
    ],
  },
  { // L2 单板开门：让幽灵替你踩住压力板
    rows: [
      'RRRRRRRRRR',
      'R.S....P.R',
      'R.RRRRRRRR',
      'R.....D..R',
      'R....E...R',
      'RRRRRRRRRR',
    ],
  },
  { // L3 门 + 双宝石
    rows: [
      'RRRRRRRRRR',
      'R.S..G.P.R',
      'R.RRRRRR.R',
      'R.G....D.R',
      'R.....E..R',
      'RRRRRRRRRR',
    ],
  },
  { // L4 双门：两块板、两扇门依次通过
    rows: [
      'RRRRRRRRRRRR',
      'R.S.P...D..R',
      'R.RRRRRRRR.R',
      'R.P...D....R',
      'R........E.R',
      'RRRRRRRRRRRR',
    ],
  },
  { // L5 双门 + 宝石 + 激光（幽灵免疫激光）
    rows: [
      'RRRRRRRRRRRR',
      'R.S.G.P....R',
      'R.RRRRRRRR.R',
      'R.GL......R',
      'R.RRRRRRRR.R',
      'R......D.E.R',
      'RRRRRRRRRRRR',
    ],
  },
];

/* ---------------- DOM ---------------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const elLevel = document.getElementById('level');
const elPhase = document.getElementById('phase');
const elGems = document.getElementById('gems');
const elBest = document.getElementById('best');
const elMenuBest = document.getElementById('menuBest');
const elOverBest = document.getElementById('overBest');
const elFinal = document.getElementById('finalScore');
const elOverTitle = document.getElementById('overTitle');
const elNewRecord = document.getElementById('newRecord');
const elToast = document.getElementById('toast');
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
let state = 'menu';
let demo = true;
let levelIndex = 0;
let grid = [];                    // 字符矩阵
let cols = 0, rows = 0;
let player = { cell: { x: 0, y: 0 }, prev: { x: 0, y: 0 } };
let ghost = { cell: { x: 0, y: 0 }, prev: { x: 0, y: 0 } };
let history = [];
let plates = [], doors = [], gems = [];
let gemsCollected = 0;
let score = 0;
let best = parseInt(localStorage.getItem(KEY_BEST) || '0', 10) || 0;
let muted = localStorage.getItem('ghostecho-muted') === '1';
let dir = null;                   // 当前移动方向
let heldDirs = new Set();
let moveT = 0, tickCount = 0;
let overReason = 'laser';
let overShown = false;
let shake = 0;
let glitches = [];
let time = 0, last = performance.now();

/* ---------------- 尺寸 ---------------- */
let W = 0, H = 0, cellS = 0, ox = 0, oy = 0;

function resize() {
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 10) return;
  W = rect.width;
  H = rect.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  layoutGrid();
}

function layoutGrid() {
  if (!cols || !rows) return;
  cellS = Math.floor(Math.min(W / cols, H / rows) * 0.9);
  ox = Math.floor((W - cols * cellS) / 2);
  oy = Math.floor((H - rows * cellS) / 2) - cellS * 0.1;
}

/* ---------------- 音频 ---------------- */
let actx = null, master = null;

function ensureAudio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    master = actx.createGain();
    master.gain.value = muted ? 0 : 0.4;
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

function playStep() { tone({ freq: 240, dur: 0.04, type: 'triangle', vol: 0.06 }); }
function playGem() { tone({ freq: 1040, dur: 0.1, vol: 0.15 }); tone({ freq: 1560, dur: 0.12, vol: 0.12, delay: 0.05 }); }
function playDoor() { tone({ freq: 300, dur: 0.12, vol: 0.12, slide: 520 }); }
function playLevel() { [392, 523, 659].forEach((f, i) => tone({ freq: f, dur: 0.13, vol: 0.14, delay: i * 0.08 })); }
function playDie() { tone({ freq: 500, dur: 0.4, type: 'sawtooth', vol: 0.16, slide: 90 }); }
function playWin() { [523, 659, 784, 1046, 1318].forEach((f, i) => tone({ freq: f, dur: 0.15, vol: 0.15, delay: i * 0.09 })); }
function playStart() { [262, 392, 523].forEach((f, i) => tone({ freq: f, dur: 0.11, vol: 0.13, delay: i * 0.07 })); }

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

const cellEq = (a, b) => a && b && a.x === b.x && a.y === b.y;

/* ---------------- 关卡加载 ---------------- */
function loadLevel(idx) {
  levelIndex = idx;
  const data = LEVELS[idx];
  grid = data.rows.map(r => r.split(''));
  rows = grid.length;
  cols = grid[0].length;
  layoutGrid();
  plates = [];
  doors = [];
  gems = [];
  let start = { x: 1, y: 1 };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const ch = grid[y][x];
      if (ch === 'S') start = { x, y };
      else if (ch === 'P') plates.push({ cell: { x, y }, id: plates.length });
      else if (ch === 'D') doors.push({ cell: { x, y }, id: doors.length });
      else if (ch === 'G') gems.push({ cell: { x, y }, taken: false });
    }
  }
  gemsCollected = 0;
  player = { cell: { ...start }, prev: { ...start } };
  ghost = { cell: { ...start }, prev: { ...start } };
  history = [];
  tickCount = 0;
  moveT = 0;
  heldDirs.clear();
  dir = null;
  updateHud();
}

function startGame() {
  ensureAudio();
  demo = false;
  overShown = false;
  levelIndex = 0;
  score = 0;
  loadLevel(0);
  state = 'playing';
  show(menuEl, false);
  show(pauseEl, false);
  show(overEl, false);
  showToast('关卡 1 · 走向出口');
  playStart();
}

function showMenu() {
  demo = true;
  loadLevel(0);
  state = 'menu';
  elMenuBest.textContent = best;
  updateHud();
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

function updateHud() {
  elLevel.textContent = levelIndex + 1;
  elBest.textContent = best;
  elGems.textContent = '✦ ' + gemsCollected + '/' + gems.length;
  elPhase.textContent = history.length > DELAY_TICKS ? '👻 回声同步' : '👻 同步中…';
}

/* ---------------- 游戏逻辑 ---------------- */
function isDoorOpen(door) {
  const p = plates.find(pl => pl.id === door.id);
  return p ? p.pressed : false;
}

function cellChar(x, y) {
  if (x < 0 || y < 0 || x >= cols || y >= rows) return 'R';
  return grid[y][x];
}

function isPassable(x, y) {
  const ch = cellChar(x, y);
  if (ch === 'R') return false;
  if (ch === 'D') {
    const d = doors.find(dd => cellEq(dd.cell, { x, y }));
    return d ? isDoorOpen(d) : false;
  }
  if (ch === 'E') return gemsCollected >= gems.length;   // 集齐宝石出口才开启
  return true;
}

function updatePlates() {
  for (const p of plates) {
    p.pressed = cellEq(player.cell, p.cell) || cellEq(ghost.cell, p.cell);
  }
}

function onEnterCell(cx, cy) {
  const ch = cellChar(cx, cy);
  if (ch === 'G') {
    const g = gems.find(gg => cellEq(gg.cell, { x: cx, y: cy }) && !gg.taken);
    if (g) {
      g.taken = true;
      gemsCollected++;
      score += 100;
      playGem();
      updateHud();
      showToast('✦ 宝石 +100');
    }
  }
  if (ch === 'L') {
    die();
    return;
  }
  if (ch === 'E' && gemsCollected >= gems.length) {
    completeLevel();
    return;
  }
}

function tickMove() {
  // 记录历史（含站立）
  history.push({ ...player.cell });
  if (history.length > DELAY_TICKS + 40) history.shift();

  // 幽灵位置 = 延迟 DELAY_TICKS 步之前
  const gi = history.length - 1 - DELAY_TICKS;
  const gj = history.length - 1 - DELAY_TICKS - 1;
  ghost.prev = { ...ghost.cell };
  ghost.cell = gi >= 0 ? { ...history[gi] } : { ...player.cell };
  if (gi < 0) ghost.prev = { ...ghost.cell };
  else ghost.prev = gj >= 0 ? { ...history[gj] } : { ...ghost.cell };

  // 玩家移动
  const d = dir;
  if (d) {
    const nx = player.cell.x + d.x, ny = player.cell.y + d.y;
    if (isPassable(nx, ny)) {
      player.prev = { ...player.cell };
      player.cell = { x: nx, y: ny };
      tickCount++;
      if (cellChar(nx, ny) === 'D') playDoor();
      else playStep();
      onEnterCell(nx, ny);
      if (state !== 'playing') return;
    }
  }
  updatePlates();
  // 幽灵碰宝石也算收集
  for (const g of gems) {
    if (!g.taken && cellEq(ghost.cell, g.cell)) {
      g.taken = true;
      gemsCollected++;
      score += 100;
      playGem();
      updateHud();
      showToast('👻 幽灵拾得宝石 +100');
    }
  }
  tickCount++;
}

function completeLevel() {
  score += 200 * (levelIndex + 1);
  updateHud();
  if (levelIndex + 1 >= LEVELS.length) {
    state = 'over';
    overReason = 'win';
    showOver();
    playWin();
  } else {
    levelIndex++;
    loadLevel(levelIndex);
    showToast('关卡 ' + (levelIndex + 1) + ' · 开始');
    playLevel();
  }
}

function die() {
  if (state !== 'playing') return;
  state = 'dying';
  overReason = 'laser';
  shake = 14;
  burst(player.cell.x, player.cell.y, 26, 0);
  playDie();
  setTimeout(() => {
    if (state !== 'dying') return;
    state = 'over';
    showOver();
  }, 900);
}

function showOver() {
  if (overShown) return;
  overShown = true;
  const isRecord = score > best;
  if (isRecord) {
    best = score;
    try { localStorage.setItem(KEY_BEST, String(best)); } catch (e) { /* 忽略 */ }
  }
  elFinal.textContent = score;
  elOverBest.textContent = best;
  elNewRecord.classList.toggle('hidden', !isRecord);
  elOverTitle.textContent = overReason === 'win' ? '通关 · 时之尽头' : '信号丢失';
  show(overEl, true);
  updateHud();
}

function retryLevel() {
  ensureAudio();
  overShown = false;
  loadLevel(levelIndex);
  state = 'playing';
  show(overEl, false);
  show(pauseEl, false);
  playStart();
}

/* ---------------- 粒子 ---------------- */
function burst(cx2, cy2, n, hue) {
  const px = ox + (cx2 + 0.5) * cellS, py = oy + (cy2 + 0.5) * cellS;
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * TAU;
    const sp = rand(40, 220);
    particles.push({
      kind: 'spark', x: px, y: py,
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      life: 0, max: rand(0.3, 0.6), size: rand(1.5, 4), hue,
    });
  }
  particles.push({ kind: 'ring', x: px, y: py, r: 6, vr: 170, life: 0, max: 0.45, hue });
}

let particles = [];

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += dt;
    if (p.life >= p.max) { particles.splice(i, 1); continue; }
    if (p.kind === 'spark') {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.max(0, 1 - dt * 2);
      p.vy *= Math.max(0, 1 - dt * 2);
    } else {
      p.r += p.vr * dt;
      p.vr *= Math.max(0, 1 - dt * 2.5);
    }
  }
}

/* ---------------- 绘制 ---------------- */
function drawSpace() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0a0c20');
  g.addColorStop(0.5, '#120e2c');
  g.addColorStop(1, '#070718');
  ctx.fillStyle = g;
  ctx.fillRect(-40, -40, W + 80, H + 80);
  // 网格线（赛博感）
  ctx.strokeStyle = 'rgba(120,150,255,0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= cols; x++) {
    ctx.moveTo(ox + x * cellS, oy);
    ctx.lineTo(ox + x * cellS, oy + rows * cellS);
  }
  for (let y = 0; y <= rows; y++) {
    ctx.moveTo(ox, oy + y * cellS);
    ctx.lineTo(ox + cols * cellS, oy + y * cellS);
  }
  ctx.stroke();
}

function drawCell(cx2, cy2, ch) {
  const px = ox + cx2 * cellS, py = oy + cy2 * cellS;
  if (ch === 'R') {
    ctx.fillStyle = '#14172e';
    ctx.fillRect(px, py, cellS, cellS);
    ctx.strokeStyle = 'rgba(90,120,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px + 2, py + 2, cellS - 4, cellS - 4);
    ctx.fillStyle = 'rgba(120,160,255,0.12)';
    ctx.fillRect(px + 4, py + 4, cellS - 8, cellS - 8);
  } else {
    ctx.fillStyle = 'rgba(10,12,30,0.6)';
    ctx.fillRect(px, py, cellS, cellS);
  }
}

function drawPlate(p) {
  const px = ox + (p.cell.x + 0.5) * cellS;
  const py = oy + (p.cell.y + 0.5) * cellS;
  const sink = p.pressed ? 4 : 0;
  ctx.save();
  ctx.strokeStyle = p.pressed ? 'rgba(125,211,252,0.95)' : 'rgba(125,211,252,0.4)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(px, py + sink, cellS * 0.3, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = p.pressed ? 'rgba(125,211,252,0.25)' : 'rgba(125,211,252,0.08)';
  ctx.beginPath();
  ctx.arc(px, py + sink, cellS * 0.3, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawDoor(d) {
  const open = isDoorOpen(d);
  const px = ox + d.cell.x * cellS, py = oy + d.cell.y * cellS;
  ctx.save();
  if (open) {
    ctx.strokeStyle = 'rgba(125,211,252,0.25)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(px + 3, py + 3, cellS - 6, cellS - 6);
    ctx.setLineDash([]);
  } else {
    const a = 0.6 + 0.3 * Math.sin(time * 6);
    ctx.fillStyle = `rgba(255,90,110,${a.toFixed(3)})`;
    for (let k = -1; k <= 1; k++) {
      ctx.fillRect(px + cellS / 2 - 2 + k * 5, py + 4, 3, cellS - 8);
    }
    ctx.fillStyle = 'rgba(255,140,160,0.25)';
    ctx.fillRect(px + 2, py + 2, cellS - 4, cellS - 4);
  }
  ctx.restore();
}

function drawLaser(cx2, cy2) {
  const px = ox + (cx2 + 0.5) * cellS, py = oy + (cy2 + 0.5) * cellS;
  const a = 0.55 + 0.3 * Math.sin(time * 8);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = `rgba(255,60,60,${a.toFixed(3)})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(px - cellS * 0.4, py);
  ctx.lineTo(px + cellS * 0.4, py);
  ctx.stroke();
  ctx.strokeStyle = `rgba(255,120,120,${(a * 0.4).toFixed(3)})`;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(px - cellS * 0.45, py);
  ctx.lineTo(px + cellS * 0.45, py);
  ctx.stroke();
  ctx.restore();
}

function drawGem(g) {
  if (g.taken) return;
  const px = ox + (g.cell.x + 0.5) * cellS;
  const py = oy + (g.cell.y + 0.5) * cellS + Math.sin(time * 2.5 + g.cell.x) * 2;
  const r = cellS * 0.22 * (1 + 0.12 * Math.sin(time * 4));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(px, py);
  ctx.rotate(time * 1.2);
  ctx.fillStyle = '#f0abfc';
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r * 0.7, 0);
  ctx.lineTo(0, r);
  ctx.lineTo(-r * 0.7, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(-r * 0.15, -r * 0.15, r * 0.25, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawExit() {
  const e = { x: 0, y: 0 };
  outer: for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (grid[y][x] === 'E') { e.x = x; e.y = y; break outer; }
    }
  }
  const px = ox + (e.x + 0.5) * cellS, py = oy + (e.y + 0.5) * cellS;
  const ready = gemsCollected >= gems.length;
  const r = cellS * 0.34 * (ready ? 1 + 0.15 * Math.sin(time * 5) : 1);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const col = ready ? '125,252,200' : '120,140,200';
  ctx.strokeStyle = `rgba(${col},0.9)`;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(px, py, r, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = `rgba(${col},0.35)`;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(px, py, r + 4, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

function lerpCell(a, b, t) {
  return {
    x: ox + (a.x + (b.x - a.x) * t + 0.5) * cellS,
    y: oy + (a.y + (b.y - a.y) * t + 0.5) * cellS,
  };
}

function drawBody(c, prev, t, isGhost) {
  const p = lerpCell(prev, c, t);
  const r = cellS * 0.32;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  if (isGhost) {
    ctx.fillStyle = 'rgba(125,211,252,0.16)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.9, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(125,211,252,0.55)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(125,211,252,0.35)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.25, 0, TAU);
    ctx.fill();
    // 幽灵眼睛
    ctx.fillStyle = 'rgba(10,16,40,0.8)';
    ctx.beginPath();
    ctx.arc(p.x - r * 0.3, p.y - r * 0.15, r * 0.18, 0, TAU);
    ctx.arc(p.x + r * 0.3, p.y - r * 0.15, r * 0.18, 0, TAU);
    ctx.fill();
  } else {
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#e8fdff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(34,211,238,0.8)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 0.55, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawGlitch() {
  for (const gl of glitches) {
    const a = gl.a * (1 - gl.t / gl.max);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = a;
    ctx.drawImage ? null : null;
    // 用偏移色带模拟 RGB 分裂
    ctx.fillStyle = `rgba(255,0,220,${(a * 0.5).toFixed(3)})`;
    ctx.fillRect(gl.x, gl.y, gl.w, gl.h);
    ctx.fillStyle = `rgba(0,255,255,${(a * 0.5).toFixed(3)})`;
    ctx.fillRect(gl.x + gl.off, gl.y, gl.w, gl.h);
    ctx.restore();
  }
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (shake > 0.4) {
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    shake *= 0.85;
  }
  drawSpace();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const ch = grid[y][x];
      if (ch === 'R') drawCell(x, y, ch);
    }
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const ch = grid[y][x];
      if (ch === 'P') drawPlate(plates.find(p => cellEq(p.cell, { x, y })));
      else if (ch === 'D') drawDoor(doors.find(d => cellEq(d.cell, { x, y })));
      else if (ch === 'L') drawLaser(x, y);
      else if (ch === 'G') drawGem(gems.find(g => cellEq(g.cell, { x, y })));
    }
  }
  drawExit();
  const t = Math.min(1, moveT / TICK);
  drawBody(ghost.cell, ghost.prev, t, true);
  drawBody(player.cell, player.prev, t, false);
  drawGlitch();
  ctx.restore();
}

/* ---------------- 输入 ---------------- */
const DIRS = {
  ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
  a: { x: -1, y: 0 }, d: { x: 1, y: 0 }, w: { x: 0, y: -1 }, s: { x: 0, y: 1 },
  A: { x: -1, y: 0 }, D: { x: 1, y: 0 }, W: { x: 0, y: -1 }, S: { x: 0, y: 1 },
};

window.addEventListener('keydown', (e) => {
  const k = e.key;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(k)) e.preventDefault();
  const d = DIRS[k];
  if (d && (state === 'playing' || state === 'menu')) {
    heldDirs.add(k);
    dir = d;
  }
  if (k === ' ' || k === 'Enter') {
    if (state === 'menu' || state === 'over') {
      if (state === 'over' && overReason !== 'win') retryLevel();
      else startGame();
    } else if (state === 'playing') setPaused(true);
    else if (state === 'paused') setPaused(false);
  } else if (k === 'p' || k === 'P' || k === 'Escape') {
    if (state === 'playing') setPaused(true);
    else if (state === 'paused') setPaused(false);
  }
});
window.addEventListener('keyup', (e) => {
  heldDirs.delete(e.key);
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
    if (dir && dir.x === -1) dir = null;
  }
  if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
    if (dir && dir.x === 1) dir = null;
  }
  if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
    if (dir && dir.y === -1) dir = null;
  }
  if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
    if (dir && dir.y === 1) dir = null;
  }
  if (!dir && heldDirs.size) {
    const lastKey = [...heldDirs][heldDirs.size - 1];
    dir = DIRS[lastKey] || null;
  }
});

startBtn.addEventListener('click', startGame);
restartBtn.addEventListener('click', retryLevel);
menuBtn.addEventListener('click', showMenu);
resumeBtn.addEventListener('click', () => setPaused(false));
pauseBtn.addEventListener('click', () => setPaused(true));
muteBtn.addEventListener('click', () => {
  muted = !muted;
  try { localStorage.setItem('ghostecho-muted', muted ? '1' : '0'); } catch (e) { /* 忽略 */ }
  if (master) master.gain.value = muted ? 0 : 0.4;
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

  if (state === 'playing' || state === 'menu') {
    moveT += dt;
    if (moveT >= TICK) {
      moveT -= TICK;
      tickMove();
      if (state === 'dying' || state === 'over') return;
    }
  }

  // 故障闪烁
  if (Math.random() < 0.03 && state !== 'menu') {
    glitches.push({ x: rand(0, W), y: rand(0, H), w: rand(30, 160), h: rand(2, 6), off: rand(4, 14), t: 0, max: rand(0.1, 0.25) });
  }
  for (let i = glitches.length - 1; i >= 0; i--) {
    glitches[i].t += dt;
    if (glitches[i].t >= glitches[i].max) glitches.splice(i, 1);
  }

  updateParticles(dt);
  draw();
}

/* ---------------- 调试钩子 ---------------- */
window.__gameDebug = () => ({
  state, demo,
  level: levelIndex + 1,
  player: { ...player.cell },
  ghost: { ...ghost.cell },
  history: history.length,
  gems: gemsCollected, gemsTotal: gems.length,
  doors: doors.map(d => ({ cell: d.cell, open: isDoorOpen(d) })),
  plates: plates.map(p => ({ cell: p.cell, pressed: !!p.pressed })),
  score, best, overReason,
});
window.__gameTest = {
  loadLevel(i) { loadLevel(i); },
  warp(x, y) { player.cell = { x, y }; player.prev = { ...player.cell }; },
  completeLevel() { if (state === 'playing') completeLevel(); },
};

/* ---------------- 初始化 ---------------- */
resize();
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
loadLevel(0);
elMenuBest.textContent = best;
muteBtn.textContent = muted ? '🔇' : '🔊';
show(menuEl, true);
if (new URLSearchParams(location.search).has('autoplay')) startGame();
requestAnimationFrame(frame);

})();
