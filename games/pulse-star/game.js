/* ============================================================
   星流节拍 · 音浪共振（Pulse Star）— 游戏引擎
   WebAudio 实时合成音游 · 四轨放射 · 极光爆发
   ============================================================ */
(() => {
'use strict';

/* ---------------- 配置 ---------------- */
const TAU = Math.PI * 2;
const LANES = 4;                  // 轨道数
const LANE_KEYS = ['d', 'f', 'j', 'k'];
const LANE_ANGLES = [-135, -45, 45, 135].map(a => a * Math.PI / 180);
const NOTE_SPEED = 330;           // 音符速度 px/s
const SPAWN_DIST = 340;           // 生成距离（距判定环）
const PERFECT_WIN = 0.045;        // Perfect 提前窗口（秒）
const GOOD_WIN = 0.09;            // Good 提前窗口（秒）
const AFTER_WIN = 0.03;           // 判定环之后的容差（秒）
const BPM_BASE = 104, BPM_MAX = 144;
const DENSITY_BASE = 1, DENSITY_MAX = 3.2;
const MAX_LIFE = 5;
const BURST_TIME = 8;             // 极光爆发持续秒数
const KEY_BEST = 'pulsestar-best';

const rand = (a, b) => a + Math.random() * (b - a);

/* ---------------- DOM ---------------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const elScore = document.getElementById('score');
const elCombo = document.getElementById('combo');
const elLife = document.getElementById('life');
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
let notes = [];
let score = 0, combo = 0;
let life = MAX_LIFE;
let best = parseInt(localStorage.getItem(KEY_BEST) || '0', 10) || 0;
let muted = localStorage.getItem('pulsestar-muted') === '1';
let energy = 0;
let burstT = 0;
let elapsed = 0;
let spawnTimer = 1;
let lastLane = -1;
let beatT = 0, beatLen = 60 / BPM_BASE;
let judgments = [];
let particles = [];
let flashT = 0, shake = 0;
let overReason = 'fail';
let overShown = false;
let time = 0, last = performance.now();

/* ---------------- 尺寸 ---------------- */
let W = 0, H = 0, cx = 0, cy = 0, R = 0;

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
  R = Math.min(W, H) * 0.26;
}

/* ---------------- 星空 ---------------- */
const nebulae = [
  { x: 0.2, y: 0.25, r: 0.55, c: '104,90,220', sx: 0.005, sy: 0.004 },
  { x: 0.8, y: 0.7, r: 0.5, c: '30,120,190', sx: -0.005, sy: 0.005 },
  { x: 0.55, y: 0.1, r: 0.4, c: '200,70,160', sx: 0.004, sy: 0.006 },
];
const stars = Array.from({ length: 100 }, () => ({
  x: Math.random(), y: Math.random(),
  r: Math.random() < 0.1 ? 1.4 + Math.random() * 1.2 : 0.6 + Math.random() * 1,
  a: 0.25 + Math.random() * 0.6,
  tw: 0.5 + Math.random() * 2,
  ph: Math.random() * TAU,
}));

/* ---------------- 音频（合成节拍） ---------------- */
let actx = null, master = null;
let nextBeatTime = 0, beatIndex = 0;

function ensureAudio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    master = actx.createGain();
    master.gain.value = muted ? 0 : 0.32;
    master.connect(actx.destination);
    nextBeatTime = actx.currentTime + 0.1;
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
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.03);
}

const SCALE = [220, 246.9, 277.2, 293.7, 329.6, 370, 392, 440, 493.9, 554.4, 587.3];

function scheduleMusic() {
  if (!actx || muted) return;
  const ahead = 0.15;
  while (nextBeatTime < actx.currentTime + ahead) {
    const t = nextBeatTime - actx.currentTime;
    // 底鼓
    tone({ freq: 130, dur: 0.12, vol: 0.3, delay: t, slide: 45 });
    // 贝斯（每 4 拍一个根音进行）
    if (beatIndex % 4 === 0) {
      const f = SCALE[(beatIndex / 4 | 0) % 4 * 2];
      tone({ freq: f / 2, dur: 0.3, type: 'sawtooth', vol: 0.14, delay: t });
    }
    // 踩镲（反拍）
    if (beatIndex % 2 === 1) {
      tone({ freq: 6200, dur: 0.04, type: 'square', vol: 0.05, delay: t });
    }
    // 琶音（每拍随机五声音阶）
    if (Math.random() < 0.5) {
      const f = SCALE[((Math.random() * 5) | 0) * 2 + 4];
      tone({ freq: f, dur: 0.14, type: 'triangle', vol: 0.08, delay: t });
    }
    nextBeatTime += beatLen;
    beatIndex++;
  }
}

function playHit(perfect) {
  const f = perfect ? 1040 : 780;
  tone({ freq: f, dur: 0.1, vol: 0.14, slide: f * 1.4 });
}
function playMiss() { tone({ freq: 180, dur: 0.25, type: 'sawtooth', vol: 0.16, slide: 70 }); }
function playBurst() { [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.14, vol: 0.16, delay: i * 0.08 })); }
function playDie() { tone({ freq: 300, dur: 0.55, type: 'sawtooth', vol: 0.2, slide: 45 }); }
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

const inBurst = () => burstT > 0;

/* ---------------- 游戏逻辑 ---------------- */
function spawnNote(lane, dist) {
  const hue = [285, 190, 45, 150][lane];
  notes.push({ lane, dist: dist !== undefined ? dist : SPAWN_DIST, hue, active: true });
}

function pickLane() {
  let lane = (Math.random() * LANES) | 0;
  if (lane === lastLane && Math.random() < 0.7) lane = (lane + 1 + ((Math.random() * 2) | 0)) % LANES;
  lastLane = lane;
  return lane;
}

function pressLane(lane) {
  if (state !== 'playing') return;
  // 找该轨道上最近的、在判定窗口内的音符
  let bestN = null, bestD = Infinity;
  const lo = -NOTE_SPEED * AFTER_WIN;
  const hi = NOTE_SPEED * GOOD_WIN;
  for (const n of notes) {
    if (n.lane !== lane || !n.active) continue;
    if (n.dist >= lo && n.dist <= hi && n.dist < bestD) { bestD = n.dist; bestN = n; }
  }
  if (!bestN) return;
  bestN.active = false;
  notes.splice(notes.indexOf(bestN), 1);
  const delta = Math.max(0, bestD / NOTE_SPEED);
  const perfect = delta <= PERFECT_WIN;
  combo++;
  const mult = inBurst() ? 2 : 1;
  score += (perfect ? 300 : 100) * mult;
  energy = Math.min(1, energy + (perfect ? 0.06 : 0.02));
  if (!inBurst() && energy >= 1) {
    burstT = BURST_TIME;
    energy = 0;
    showToast('✦ 极光爆发 ×2');
    playBurst();
    elCombo.classList.add('burst');
  }
  const pos = lanePos(lane, R);
  judgments.push({ text: perfect ? 'PERFECT' : 'GOOD', x: pos.x, y: pos.y, t: 0, max: 0.6, perfect });
  burst(pos.x, pos.y, perfect ? 12 : 6, bestN.hue);
  ring(pos.x, pos.y, bestN.hue);
  playHit(perfect);
  updateHud(true);
}

function miss() {
  combo = 0;
  life--;
  flashT = 1;
  shake = Math.max(shake, 6);
  playMiss();
  updateHud(true);
  if (life <= 0) die();
}

function die() {
  if (state !== 'playing') return;
  state = 'dying';
  overReason = 'fail';
  playDie();
  setTimeout(() => {
    if (state !== 'dying') return;
    state = 'over';
    showOver();
  }, 1000);
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
  elOverTitle.textContent = overReason === 'fail' ? '星流紊乱' : '游戏结束';
  show(overEl, true);
  updateHud();
}

function startGame() {
  ensureAudio();
  demo = false;
  overShown = false;
  notes = [];
  score = 0;
  combo = 0;
  life = MAX_LIFE;
  energy = 0;
  burstT = 0;
  elapsed = 0;
  spawnTimer = 0.8;
  beatT = 0;
  judgments = [];
  particles.length = 0;
  flashT = 0;
  shake = 0;
  elCombo.classList.remove('burst');
  state = 'playing';
  updateHud(true);
  show(menuEl, false);
  show(pauseEl, false);
  show(overEl, false);
  playStart();
}

function showMenu() {
  demo = true;
  notes = [];
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

function updateHud(popScore) {
  elScore.textContent = score;
  elBest.textContent = best;
  elCombo.textContent = combo >= 2 ? '连击 ×' + combo : '连击 -';
  elLife.textContent = '♥'.repeat(Math.max(0, life)) + '♡'.repeat(Math.max(0, MAX_LIFE - life));
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
function lanePos(lane, radius) {
  const a = LANE_ANGLES[lane];
  return { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius };
}

function step(dt) {
  elapsed += dt;
  const bpm = Math.min(BPM_MAX, BPM_BASE + elapsed * 0.5);
  beatLen = 60 / bpm;
  const density = Math.min(DENSITY_MAX, DENSITY_BASE + elapsed / 40);

  beatT += dt;
  if (beatT >= beatLen) beatT -= beatLen;

  // 生成音符
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnNote(pickLane());
    spawnTimer = beatLen / density;
  }

  // 音符前进
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    n.dist -= NOTE_SPEED * dt;
    if (n.dist < -NOTE_SPEED * AFTER_WIN) {
      notes.splice(i, 1);
      const pos = lanePos(n.lane, R);
      judgments.push({ text: 'MISS', x: pos.x, y: pos.y, t: 0, max: 0.5, perfect: false });
      miss();
    }
  }

  // 极光爆发倒计时
  if (burstT > 0) {
    burstT -= dt;
    if (burstT <= 0) {
      burstT = 0;
      elCombo.classList.remove('burst');
      showToast('爆发结束');
    }
  }

  // 判定文字
  for (let i = judgments.length - 1; i >= 0; i--) {
    judgments[i].t += dt;
    if (judgments[i].t >= judgments[i].max) judgments.splice(i, 1);
  }
}

/* ---------------- 粒子 ---------------- */
function burst(x, y, n, hue) {
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * TAU;
    const sp = rand(50, 230);
    particles.push({
      kind: 'spark', x, y,
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      life: 0, max: rand(0.3, 0.6), size: rand(1.5, 3.5), hue,
    });
  }
}

function ring(x, y, hue) {
  particles.push({ kind: 'ring', x, y, r: 6, vr: 180, life: 0, max: 0.4, hue });
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += dt;
    if (p.life >= p.max) { particles.splice(i, 1); continue; }
    if (p.kind === 'spark') {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.max(0, 1 - dt * 2.2);
      p.vy *= Math.max(0, 1 - dt * 2.2);
    } else {
      p.r += p.vr * dt;
      p.vr *= Math.max(0, 1 - dt * 2.5);
    }
  }
}

/* ---------------- 绘制 ---------------- */
function drawSpace() {
  const burst = inBurst();
  const g = ctx.createLinearGradient(0, 0, 0, H);
  if (burst) {
    g.addColorStop(0, '#2a1430');
    g.addColorStop(0.5, '#2a1636');
    g.addColorStop(1, '#1a0a20');
  } else {
    g.addColorStop(0, '#0b0f2e');
    g.addColorStop(0.5, '#120e33');
    g.addColorStop(1, '#08081c');
  }
  ctx.fillStyle = g;
  ctx.fillRect(-40, -40, W + 80, H + 80);
  for (const nb of nebulae) {
    const nx = (((nb.x + time * nb.sx) % 1.2) + 1.2) % 1.2 - 0.1;
    const ny = (((nb.y + time * nb.sy) % 1.2) + 1.2) % 1.2 - 0.1;
    const px = nx * W, py = ny * H, pr = nb.r * Math.max(W, H);
    const ng = ctx.createRadialGradient(px, py, 0, px, py, pr);
    ng.addColorStop(0, `rgba(${nb.c},${burst ? 0.2 : 0.14})`);
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

function drawLanes() {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  for (let i = 0; i < LANES; i++) {
    const a = LANE_ANGLES[i];
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (R + 10), cy + Math.sin(a) * (R + 10));
    ctx.lineTo(cx + Math.cos(a) * (R + SPAWN_DIST), cy + Math.sin(a) * (R + SPAWN_DIST));
    ctx.stroke();
  }
  // 判定环
  const pulse = 1 + 0.05 * Math.sin(time * (inBurst() ? 10 : 6));
  ctx.beginPath();
  ctx.arc(cx, cy, R * pulse, 0, TAU);
  ctx.strokeStyle = inBurst() ? 'rgba(255,211,110,0.85)' : 'rgba(167,139,250,0.8)';
  ctx.lineWidth = 2.5;
  ctx.shadowColor = inBurst() ? '#ffd36e' : '#a78bfa';
  ctx.shadowBlur = 14;
  ctx.stroke();
  ctx.shadowBlur = 0;
  // 生成环（虚线）
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 10]);
  ctx.beginPath();
  ctx.arc(cx, cy, R + SPAWN_DIST, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  // 能量弧
  if (energy > 0.01) {
    ctx.beginPath();
    ctx.arc(cx, cy, R + 14, -Math.PI / 2, -Math.PI / 2 + energy * TAU);
    ctx.strokeStyle = 'rgba(255,211,110,0.95)';
    ctx.lineWidth = 4;
    ctx.shadowColor = '#ffd36e';
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

function drawNotes() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const n of notes) {
    const radius = R + Math.max(-10, n.dist);
    const pos = lanePos(n.lane, radius);
    const approach = 1 - Math.max(0, n.dist) / SPAWN_DIST;   // 越近越亮
    const size = 9 + approach * 4;
    ctx.fillStyle = `hsla(${n.hue},95%,${(60 + approach * 25).toFixed(0)}%,${(0.7 + approach * 0.3).toFixed(3)})`;
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.restore();
    ctx.strokeStyle = `hsla(${n.hue},95%,80%,${(0.4 + approach * 0.5).toFixed(3)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, size * 0.75, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

function drawJudgments() {
  ctx.save();
  ctx.textAlign = 'center';
  for (const j of judgments) {
    const k = 1 - j.t / j.max;
    ctx.font = `700 ${18 + (1 - k) * 10}px Orbitron, monospace`;
    ctx.fillStyle = j.perfect
      ? `rgba(255,211,110,${(k).toFixed(3)})`
      : j.text === 'MISS'
        ? `rgba(255,90,90,${(k).toFixed(3)})`
        : `rgba(125,252,200,${(k).toFixed(3)})`;
    ctx.shadowColor = j.perfect ? '#ffd36e' : '#ff5a5a';
    ctx.shadowBlur = 12;
    ctx.fillText(j.text, j.x, j.y - (1 - k) * 26);
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

function drawCombo() {
  if (combo >= 2 && state !== 'over') {
    ctx.save();
    ctx.font = `900 ${Math.min(40, R * 0.3)}px Orbitron, monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = inBurst() ? 'rgba(255,211,110,0.95)' : 'rgba(240,171,252,0.9)';
    ctx.shadowColor = inBurst() ? '#ffd36e' : '#f0abfc';
    ctx.shadowBlur = 18;
    ctx.fillText('×' + combo, cx, cy - R - 30);
    ctx.restore();
  }
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

function draw() {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (shake > 0.4) {
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    shake *= 0.88;
  }
  drawSpace();
  drawLanes();
  drawNotes();
  drawJudgments();
  drawCombo();
  drawParticles();
  if (flashT > 0.02) {
    ctx.fillStyle = `rgba(255,90,80,${(flashT * 0.16).toFixed(3)})`;
    ctx.fillRect(-40, -40, W + 80, H + 80);
    flashT *= 0.9;
  }
  if (inBurst()) {
    ctx.fillStyle = `rgba(255,211,110,${(0.04 + 0.03 * Math.sin(time * 8)).toFixed(3)})`;
    ctx.fillRect(-40, -40, W + 80, H + 80);
  }
  ctx.restore();
}

/* ---------------- 输入 ---------------- */
function pressLaneByKey(k) {
  const idx = LANE_KEYS.indexOf(k.toLowerCase());
  if (idx >= 0) pressLane(idx);
}

window.addEventListener('keydown', (e) => {
  const k = e.key;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(k)) e.preventDefault();
  if (state === 'playing') pressLaneByKey(k);
  if (k === ' ' || k === 'Enter') {
    if (state === 'menu' || state === 'over') startGame();
    else if (state === 'playing') setPaused(true);
    else if (state === 'paused') setPaused(false);
  } else if (k === 'p' || k === 'P' || k === 'Escape') {
    if (state === 'playing') setPaused(true);
    else if (state === 'paused') setPaused(false);
  }
});

function pointerPress(x) {
  ensureAudio();
  if (state === 'menu' || state === 'over') { startGame(); return; }
  if (state !== 'playing') return;
  const lane = Math.min(LANES - 1, Math.max(0, Math.floor((x / W) * LANES)));
  pressLane(lane);
}

canvas.addEventListener('pointerdown', (e) => {
  const rect = canvas.getBoundingClientRect();
  pointerPress(e.clientX - rect.left);
});
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  pointerPress(e.changedTouches[0].clientX - rect.left);
}, { passive: false });

startBtn.addEventListener('click', startGame);
restartBtn.addEventListener('click', startGame);
menuBtn.addEventListener('click', showMenu);
resumeBtn.addEventListener('click', () => setPaused(false));
pauseBtn.addEventListener('click', () => setPaused(true));
muteBtn.addEventListener('click', () => {
  muted = !muted;
  try { localStorage.setItem('pulsestar-muted', muted ? '1' : '0'); } catch (e) { /* 忽略 */ }
  if (master) master.gain.value = muted ? 0 : 0.32;
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
    step(dt);
    scheduleMusic();
  } else if (state === 'menu') {
    beatT += dt;
    if (beatT >= 60 / BPM_BASE) beatT -= 60 / BPM_BASE;
    spawnTimer -= dt;
    if (spawnTimer <= 0) { spawnNote(pickLane()); spawnTimer = 0.55; }
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      n.dist -= NOTE_SPEED * 0.55 * dt;
      if (n.dist < 0) notes.splice(i, 1);
    }
  }

  updateParticles(dt);
  draw();
}

/* ---------------- 调试钩子 ---------------- */
window.__gameDebug = () => ({
  state, demo,
  score, combo, life, best,
  energy, burst: burstT > 0,
  bpm: Math.min(BPM_MAX, BPM_BASE + elapsed * 0.5),
  notes: notes.map(n => ({ lane: n.lane, dist: n.dist })),
  overReason,
});
window.__gameTest = {
  spawnNote(lane, dist) { spawnNote(lane, dist); },
  pressLane(lane) { pressLane(lane); },
  fillEnergy() { energy = 0.999; },
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
