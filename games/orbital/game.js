/* ============================================================
   星环守卫 · 轨道哨兵（Orbital Sentinel）— 游戏引擎
   360° 环形防御 · 转动护盾弹反陨石
   ============================================================ */
(() => {
'use strict';

/* ---------------- 配置 ---------------- */
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const STAR_R = 26;                 // 恒星半径
const ORBIT_R_F = 0.33;            // 轨道半径 = min(W,H) × 系数
const SHIELD_BASE = 38 * DEG;      // 护盾半角（基础）
const SHIELD_MAX = 65 * DEG;       // 护盾半角（上限）
const ROT_SPEED = 3.1;             // 键盘转速 rad/s
const METEOR_BASE_SPEED = 205;     // 陨石基础速度 px/s
const METEOR_SPEED_GROW = 1.1;     // 每秒增速
const SPAWN_BASE = 1.05;           // 初始生成间隔（秒）
const SPAWN_MIN = 0.3;
const MAX_HEARTS = 3;
const DUST_EVERY = 3.5;            // 星尘生成间隔
const KEY_BEST = 'orbital-best';

const rand = (a, b) => a + Math.random() * (b - a);

/* ---------------- DOM ---------------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const elScore = document.getElementById('score');
const elCombo = document.getElementById('combo');
const elHearts = document.getElementById('hearts');
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
let theta = 0;                     // 护盾中心角
let shieldHalf = SHIELD_BASE;
let meteors = [], dusts = [], particles = [];
let hearts = MAX_HEARTS;
let score = 0, combo = 0;
let best = parseInt(localStorage.getItem(KEY_BEST) || '0', 10) || 0;
let muted = localStorage.getItem('orbital-muted') === '1';
let elapsed = 0;
let spawnTimer = 1, dustTimer = 2;
let flashT = 0, shake = 0;
let dragging = false, targetTheta = null;
let keys = { left: false, right: false };
let overReason = 'star';
let overShown = false;
let time = 0, last = performance.now();

/* ---------------- 尺寸 ---------------- */
let W = 0, H = 0, cx = 0, cy = 0, R = 0, cell = 1;

function resize() {
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 10) return;
  W = rect.width;
  H = rect.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx = W / 2;
  cy = H / 2;
  R = Math.min(W, H) * ORBIT_R_F;
  cell = Math.max(W, H) / 24;
}

/* ---------------- 星空 ---------------- */
const nebulae = [
  { x: 0.2, y: 0.25, r: 0.55, c: '104,90,220', sx: 0.005, sy: 0.004 },
  { x: 0.8, y: 0.7, r: 0.5, c: '30,120,190', sx: -0.005, sy: 0.005 },
  { x: 0.55, y: 0.1, r: 0.4, c: '200,70,160', sx: 0.004, sy: 0.006 },
];
const stars = Array.from({ length: 110 }, () => ({
  x: Math.random(), y: Math.random(),
  r: Math.random() < 0.1 ? 1.4 + Math.random() * 1.2 : 0.6 + Math.random() * 1,
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

function playDeflect() {
  const f = 600 + Math.min(combo, 20) * 30;
  tone({ freq: f, dur: 0.07, vol: 0.14, slide: f * 1.6 });
}
function playHit() { tone({ freq: 160, dur: 0.3, type: 'sawtooth', vol: 0.2, slide: 70 }); }
function playDust() { tone({ freq: 880, dur: 0.1, vol: 0.15 }); tone({ freq: 1320, dur: 0.12, vol: 0.12, delay: 0.05 }); }
function playDie() { tone({ freq: 260, dur: 0.6, type: 'sawtooth', vol: 0.22, slide: 40 }); tone({ freq: 130, dur: 0.7, vol: 0.16, delay: 0.1, slide: 30 }); }
function playStart() { [262, 392, 523].forEach((f, i) => tone({ freq: f, dur: 0.11, vol: 0.14, delay: i * 0.07 })); }

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
  toastTimer = setTimeout(() => elToast.classList.add('hidden'), 1600);
}

/** 归一化角度差到 [-π, π] */
function angDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/* ---------------- 生成 ---------------- */
function spawnMeteor() {
  const angle = Math.random() * TAU;
  const speed = METEOR_BASE_SPEED + elapsed * METEOR_SPEED_GROW + rand(-30, 40);
  meteors.push({
    angle,
    r: Math.max(W, H) * 0.72,
    speed: Math.min(speed, 520),
    size: rand(6, 13),
    hue: Math.random() < 0.3 ? rand(190, 220) : rand(20, 50),
    prevR: 1e9,
  });
}

function spawnDust() {
  dusts.push({ angle: Math.random() * TAU, r: R + rand(60, 170) });
}

/* ---------------- 流程 ---------------- */
function deflect(m) {
  const i = meteors.indexOf(m);
  if (i >= 0) meteors.splice(i, 1);
  combo++;
  score += 10 * combo;
  const pos = polar(m.angle, R);
  burst(pos.x, pos.y, 12, m.hue);
  ring(pos.x, pos.y, m.hue);
  flashT = Math.max(flashT, 0.25);
  playDeflect();
  updateHud(true);
}

function hit(m) {
  const i = meteors.indexOf(m);
  if (i >= 0) meteors.splice(i, 1);
  combo = 0;
  hearts--;
  flashT = 1;
  shake = Math.max(shake, 8);
  playHit();
  updateHud(true);
  if (hearts <= 0) die();
}

function collectDust(d) {
  const i = dusts.indexOf(d);
  if (i >= 0) dusts.splice(i, 1);
  shieldHalf = Math.min(SHIELD_MAX, shieldHalf + 7 * DEG);
  score += 25;
  const pos = polar(d.angle, R);
  burst(pos.x, pos.y, 14, 285);
  showToast('✦ 护盾扩展 +7°');
  playDust();
  updateHud(true);
}

function die() {
  if (state !== 'playing') return;
  state = 'dying';
  overReason = 'star';
  shake = 16;
  burst(cx, cy, 40, 45);
  ring(cx, cy, 45);
  playDie();
  setTimeout(() => {
    if (state !== 'dying') return;
    state = 'over';
    showOver();
  }, 1100);
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
  elOverTitle.textContent = overReason === 'star' ? '恒星湮灭' : '游戏结束';
  show(overEl, true);
  updateHud();
}

function startGame() {
  ensureAudio();
  demo = false;
  overShown = false;
  theta = 0;
  shieldHalf = SHIELD_BASE;
  meteors = [];
  dusts = [];
  particles.length = 0;
  hearts = MAX_HEARTS;
  score = 0;
  combo = 0;
  elapsed = 0;
  spawnTimer = 1;
  dustTimer = 2;
  flashT = 0;
  shake = 0;
  state = 'playing';
  updateHud(true);
  show(menuEl, false);
  show(pauseEl, false);
  show(overEl, false);
  playStart();
}

function showMenu() {
  demo = true;
  meteors = [];
  dusts = [];
  particles.length = 0;
  state = 'menu';
  theta = 0;
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

function updateHud(popScore) {
  elScore.textContent = score;
  elBest.textContent = best;
  elCombo.textContent = combo >= 2 ? '连击 ×' + combo : '连击 -';
  elHearts.textContent = '♥'.repeat(Math.max(0, hearts)) + '♡'.repeat(Math.max(0, MAX_HEARTS - hearts));
  if (popScore) {
    elScore.classList.remove('pop');
    void elScore.offsetWidth;
    elScore.classList.add('pop');
    if (combo >= 2) {
      elCombo.classList.remove('big');
      void elCombo.offsetWidth;
      elCombo.classList.add('big');
    }
  }
}

/* ---------------- 更新 ---------------- */
function polar(angle, radius) {
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
}

function step(dt) {
  // 护盾转向
  let target = null;
  if (keys.left) target = theta - ROT_SPEED * dt;
  else if (keys.right) target = theta + ROT_SPEED * dt;
  if (target !== null) theta = ((target % TAU) + TAU) % TAU;
  if (dragging && targetTheta !== null) {
    theta = ((theta + angDiff(targetTheta, theta) * Math.min(1, 16 * dt)) % TAU + TAU) % TAU;
  }

  // 生成
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnMeteor();
    spawnTimer = Math.max(SPAWN_MIN, SPAWN_BASE - elapsed * 0.008);
  }
  dustTimer -= dt;
  if (dustTimer <= 0) {
    spawnDust();
    dustTimer = DUST_EVERY;
  }

  // 陨石
  for (let i = meteors.length - 1; i >= 0; i--) {
    const m = meteors[i];
    m.prevR = m.r;
    m.r -= m.speed * dt;
    if (m.prevR > R && m.r <= R) {
      if (Math.abs(angDiff(theta, m.angle)) <= shieldHalf) deflect(m);
      else hit(m);
      continue;
    }
    if (m.r < STAR_R + 4) { meteors.splice(i, 1); }
  }

  // 星尘
  for (let i = dusts.length - 1; i >= 0; i--) {
    const d = dusts[i];
    d.r -= 105 * dt;
    if (d.r <= R && Math.abs(angDiff(theta, d.angle)) <= shieldHalf + 4 * DEG) {
      collectDust(d);
    } else if (d.r < STAR_R + 10) {
      dusts.splice(i, 1);
    }
  }
}

/* ---------------- 粒子 ---------------- */
function burst(x, y, n, hueBase) {
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * TAU;
    const sp = rand(60, 260);
    particles.push({
      kind: 'spark', x, y,
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      life: 0, max: rand(0.35, 0.7),
      size: rand(1.5, 4),
      hue: hueBase + rand(-25, 25),
    });
  }
}

function ring(x, y, hue) {
  particles.push({ kind: 'ring', x, y, r: 6, vr: 190, life: 0, max: 0.45, hue });
}

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
    ng.addColorStop(0, `rgba(${nb.c},0.14)`);
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

function drawOrbit() {
  ctx.save();
  // 轨道环
  ctx.strokeStyle = 'rgba(139,92,246,0.4)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(139,92,246,0.18)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, TAU);
  ctx.stroke();
  // 刻度
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU + time * 0.05;
    const p1 = polar(a, R - 12), p2 = polar(a, R - 6);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawShield() {
  const half = shieldHalf;
  const a0 = theta - half, a1 = theta + half;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // 护盾光带
  ctx.beginPath();
  ctx.arc(cx, cy, R, a0, a1);
  ctx.strokeStyle = 'rgba(125,211,252,0.28)';
  ctx.lineWidth = 26;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, R, a0, a1);
  ctx.strokeStyle = 'rgba(167,139,250,0.9)';
  ctx.lineWidth = 6;
  ctx.shadowColor = '#a78bfa';
  ctx.shadowBlur = 16;
  ctx.stroke();
  ctx.shadowBlur = 0;
  // 护盾两端光点
  for (const a of [a0, a1]) {
    const p = polar(a, R);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, TAU);
    ctx.fill();
  }
  // 哨兵飞船（护盾中心）
  const sp = polar(theta, R);
  const tang = theta + Math.PI / 2;
  ctx.translate(sp.x, sp.y);
  ctx.rotate(tang);
  ctx.fillStyle = '#f0abfc';
  ctx.beginPath();
  ctx.moveTo(10, 0);
  ctx.lineTo(-7, -7);
  ctx.lineTo(-3, 0);
  ctx.lineTo(-7, 7);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(2, 0, 2.4, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawStar() {
  const pulse = 1 + 0.08 * Math.sin(time * 3);
  const r = STAR_R * pulse;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 4);
  g.addColorStop(0, 'rgba(255,240,200,0.9)');
  g.addColorStop(0.35, 'rgba(255,180,90,0.35)');
  g.addColorStop(1, 'rgba(255,120,60,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 4, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#fff7e0';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
  // 旋转光芒
  ctx.strokeStyle = 'rgba(255,220,150,0.5)';
  ctx.lineWidth = 2;
  for (let k = 0; k < 4; k++) {
    const a = time * 0.4 + (k / 4) * TAU;
    const p1 = polar(a, r + 6), p2 = polar(a, r * 2.6);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMeteor(m) {
  const pos = polar(m.angle, m.r);
  const prev = polar(m.angle, Math.min(m.prevR, m.r + m.speed * 0.12));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // 拖尾
  ctx.strokeStyle = `hsla(${m.hue},90%,60%,0.4)`;
  ctx.lineWidth = m.size * 0.7;
  ctx.beginPath();
  ctx.moveTo(prev.x, prev.y);
  ctx.lineTo(pos.x, pos.y);
  ctx.stroke();
  // 本体
  const g = ctx.createRadialGradient(pos.x - m.size * 0.3, pos.y - m.size * 0.3, 1, pos.x, pos.y, m.size);
  g.addColorStop(0, `hsl(${m.hue},85%,85%)`);
  g.addColorStop(0.6, `hsl(${m.hue},80%,55%)`);
  g.addColorStop(1, `hsla(${m.hue},80%,45%,0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, m.size, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawDust(d) {
  const pos = polar(d.angle, d.r);
  const tw = 0.5 + 0.5 * Math.sin(time * 5 + d.angle * 3);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = `rgba(255,220,140,${(0.7 * tw + 0.3).toFixed(3)})`;
  ctx.lineWidth = 1.6;
  const l = 7 + 4 * tw;
  ctx.beginPath();
  ctx.moveTo(pos.x - l, pos.y);
  ctx.lineTo(pos.x + l, pos.y);
  ctx.moveTo(pos.x, pos.y - l);
  ctx.lineTo(pos.x, pos.y + l);
  ctx.stroke();
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
      ctx.lineWidth = Math.max(1.5, 3 * k);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawCombo() {
  if (combo >= 2 && (state === 'playing' || state === 'dying')) {
    ctx.save();
    ctx.font = `900 ${Math.min(44, cell * 1.6)}px Orbitron, monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(240,171,252,0.9)';
    ctx.shadowColor = '#f0abfc';
    ctx.shadowBlur = 18;
    ctx.fillText('×' + combo, cx, cy - R - 34);
    ctx.restore();
  }
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (shake > 0.4) {
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    shake *= 0.88;
  }
  drawSpace();
  drawOrbit();
  for (const d of dusts) drawDust(d);
  for (const m of meteors) drawMeteor(m);
  drawShield();
  drawStar();
  drawCombo();
  drawParticles();
  if (flashT > 0.02) {
    ctx.fillStyle = `rgba(255,90,80,${(flashT * 0.18).toFixed(3)})`;
    ctx.fillRect(-40, -40, W + 80, H + 80);
    flashT *= 0.9;
  }
  ctx.restore();
}

/* ---------------- 输入 ---------------- */
canvas.addEventListener('pointerdown', (e) => {
  ensureAudio();
  if (state === 'menu' || state === 'over') { startGame(); return; }
  if (state !== 'playing') return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  targetTheta = Math.atan2(y - cy, x - cx);
  dragging = true;
});
window.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  targetTheta = Math.atan2(y - cy, x - cx);
});
window.addEventListener('pointerup', () => { dragging = false; targetTheta = null; });
window.addEventListener('pointercancel', () => { dragging = false; targetTheta = null; });

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  ensureAudio();
  if (state === 'menu' || state === 'over') { startGame(); return; }
  if (state !== 'playing') return;
  const rect = canvas.getBoundingClientRect();
  const t = e.changedTouches[0];
  targetTheta = Math.atan2((t.clientY - rect.top) - cy, (t.clientX - rect.left) - cx);
  dragging = true;
}, { passive: false });
window.addEventListener('touchmove', (e) => {
  if (!dragging) return;
  const rect = canvas.getBoundingClientRect();
  const t = e.changedTouches[0];
  targetTheta = Math.atan2((t.clientY - rect.top) - cy, (t.clientX - rect.left) - cx);
}, { passive: true });
window.addEventListener('touchend', () => { dragging = false; targetTheta = null; });

window.addEventListener('keydown', (e) => {
  const k = e.key;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(k)) e.preventDefault();
  if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = true;
  if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = true;
  if (k === ' ' || k === 'Enter') {
    if (state === 'menu' || state === 'over') startGame();
    else if (state === 'playing') setPaused(true);
    else if (state === 'paused') setPaused(false);
  } else if (k === 'p' || k === 'P' || k === 'Escape') {
    if (state === 'playing') setPaused(true);
    else if (state === 'paused') setPaused(false);
  }
});
window.addEventListener('keyup', (e) => {
  const k = e.key;
  if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = false;
  if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = false;
});

startBtn.addEventListener('click', startGame);
restartBtn.addEventListener('click', startGame);
menuBtn.addEventListener('click', showMenu);
resumeBtn.addEventListener('click', () => setPaused(false));
pauseBtn.addEventListener('click', () => setPaused(true));
muteBtn.addEventListener('click', () => {
  muted = !muted;
  try { localStorage.setItem('orbital-muted', muted ? '1' : '0'); } catch (e) { /* 忽略 */ }
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
  if (state === 'playing') {
    elapsed += dt;
    step(dt);
  } else if (state === 'menu') {
    theta = ((theta + 0.22 * dt) % TAU + TAU) % TAU;   // 演示：护盾缓缓自转
    dustTimer -= dt;
    if (dustTimer <= 0) { spawnDust(); dustTimer = DUST_EVERY; }
    for (let i = dusts.length - 1; i >= 0; i--) {
      const d = dusts[i];
      d.r -= 60 * dt;
      if (d.r < STAR_R + 10) dusts.splice(i, 1);
    }
  }
  updateParticles(dt);
  draw();
}

/* ---------------- 调试钩子 ---------------- */
window.__gameDebug = () => ({
  state, demo,
  score, combo, hearts, best,
  theta: ((theta % TAU) + TAU) % TAU,
  shieldHalf,
  meteors: meteors.length,
  dust: dusts.length,
  elapsed,
  overReason,
});
window.__gameTest = {
  setTheta(deg) { theta = deg * DEG; },
  spawnMeteor(angleDeg, radius, speed) {
    meteors.push({ angle: angleDeg * DEG, r: radius, speed: speed || 200, size: 10, hue: 35, prevR: 1e9 });
  },
  spawnDust(angleDeg, radius) {
    dusts.push({ angle: angleDeg * DEG, r: radius });
  },
};

/* ---------------- 初始化 ---------------- */
resize();
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
elMenuBest.textContent = best;
muteBtn.textContent = muted ? '🔇' : '🔊';
updateHud();
show(menuEl, true);
if (new URLSearchParams(location.search).has('autoplay')) startGame();
requestAnimationFrame(frame);

})();
