/* ============================================================
   踏云行 · 水墨跳山（Ink Leap）— 游戏引擎
   蓄力跳跃 · 程序化平台 · 国风水墨渲染
   ============================================================ */
(() => {
'use strict';

/* ---------------- 配置 ---------------- */
const GRAV = 2050;              // 重力 px/s²
const JUMP_MIN = 660;           // 最小起跳速度
const JUMP_MAX = 1420;          // 满蓄力起跳速度
const CHARGE_TIME = 0.55;       // 蓄满所需秒数
const MOVE_ACC = 3800;          // 水平加速度
const MOVE_MAX = 400;           // 水平速度上限
const COYOTE = 0.12;            // 土狼时间（离台后仍可跳）
const PPM = 10;                 // 每米像素
const LOTUS_BOUNCE = 0.85;      // 墨莲反弹系数
const KILL_OFFSET = 30;         // 坠出屏幕底部多少判定死亡
const KEY_BEST = 'ink-leap-best';
const TAU = Math.PI * 2;

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clamp01 = v => clamp(v, 0, 1);

/* ---------------- DOM ---------------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const elHeight = document.getElementById('height');
const elSeals = document.getElementById('seals');
const elBest = document.getElementById('best');
const elMenuBest = document.getElementById('menuBest');
const elOverBest = document.getElementById('overBest');
const elFinal = document.getElementById('finalHeight');
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
let state = 'menu';           // menu | playing | paused | dying | over
let demo = true;
let player = { x: 0, y: 0, vx: 0, vy: 0, onPlatform: true, coyote: 0, charging: false, charge: 0 };
let platforms = [];
let seals = [];
let particles = [];
let camY = 0;
let height = 0;
let best = parseInt(localStorage.getItem(KEY_BEST) || '0', 10) || 0;
let muted = localStorage.getItem('ink-leap-muted') === '1';
let overReason = 'fall';
let overShown = false;
let nextMilestone = 100;
let steerX = null;            // 指针目标 x
let keys = { left: false, right: false };
let shake = 0;
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

function playJump() { tone({ freq: 380, dur: 0.16, vol: 0.14, slide: 980 }); }
function playSeal() { tone({ freq: 1180, dur: 0.12, vol: 0.16 }); tone({ freq: 1560, dur: 0.14, vol: 0.12, delay: 0.06 }); }
function playBreak() { tone({ freq: 150, dur: 0.25, type: 'triangle', vol: 0.18, slide: 70 }); }
function playMilestone() { [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.14, vol: 0.14, delay: i * 0.09 })); }
function playDie() { tone({ freq: 320, dur: 0.5, type: 'sawtooth', vol: 0.15, slide: 60 }); }
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

/* ---------------- 世界生成 ---------------- */
function makePlatform(x, y, w, type, vx) {
  return { x, y, w, type, vx: vx || 0, seed: Math.random() * 1000 };
}

function pickType() {
  const bad = Math.min(0.06 + height / 5000, 0.28);
  const lotus = 0.1, drift = 0.16;
  const r = Math.random();
  if (height > 60 && r < bad) return 'bad';
  if (r < bad + lotus) return 'lotus';
  if (height > 20 && r < bad + lotus + drift) return 'drift';
  return height > 30 && Math.random() < 0.45 ? 'stone' : 'cloud';
}

function initWorld() {
  platforms = [];
  seals = [];
  particles.length = 0;
  player = { x: W / 2, y: 0, vx: 0, vy: 0, onPlatform: true, coyote: 0, charging: false, charge: 0 };
  height = 0;
  camY = -H * 0.55;
  nextMilestone = 100;
  platforms.push(makePlatform(W / 2 - 46, 0, 92, 'cloud'));
  let genY = 0;
  let lastX = W / 2 - 46;
  while (genY > camY - 340) {
    genY -= rand(95, 125) + Math.min(height * 0.35, 130);
    const maxStep = Math.min(150 + (0 - genY) * 0.35, 230);
    const w = rand(64, 110);
    const x = clamp(lastX + rand(-maxStep, maxStep), 10, W - 10 - w);
    const type = pickType();
    const p = makePlatform(x, genY, w, type, type === 'drift' ? rand(-36, 36) : 0);
    platforms.push(p);
    if (Math.random() < 0.42 && type !== 'bad') {
      seals.push({ x: x + w / 2 + rand(-12, 12), y: genY - 48, taken: false });
    }
    lastX = x;
  }
  updateHud(true);
}

function cullWorld() {
  for (let i = platforms.length - 1; i >= 0; i--) {
    if (platforms[i].y - camY > H + 260) platforms.splice(i, 1);
  }
  for (let i = seals.length - 1; i >= 0; i--) {
    if (seals[i].y - camY > H + 260) seals.splice(i, 1);
  }
}

/* ---------------- 物理 ---------------- */
function doJump() {
  const power = JUMP_MIN + player.charge * (JUMP_MAX - JUMP_MIN);
  player.vy = -power;
  player.onPlatform = false;
  player.coyote = 0;
  player.charge = 0;
  splash(player.x, player.y, 8, power / 400);
  playJump();
}

function updatePlayer(dt) {
  // 水平移动
  let target = 0;
  if (steerX !== null && player.charging) {
    target = steerX > player.x ? 1 : steerX < player.x ? -1 : 0;
    if (Math.abs(steerX - player.x) < 12) target = 0;
  }
  if (keys.left) target -= 1;
  if (keys.right) target += 1;
  target = clamp(target, -1, 1);
  if (target !== 0) {
    player.vx += target * MOVE_ACC * dt;
  } else {
    player.vx *= Math.max(0, 1 - 9 * dt);
  }
  player.vx = clamp(player.vx, -MOVE_MAX, MOVE_MAX);
  player.x += player.vx * dt;
  player.x = clamp(player.x, 14, W - 14);

  // 蓄力
  if (player.charging && (player.onPlatform || player.coyote > 0)) {
    player.charge = clamp01(player.charge + dt / CHARGE_TIME);
  }

  // 垂直
  player.vy += GRAV * dt;
  player.y += player.vy * dt;
  if (!player.onPlatform) player.coyote = Math.max(0, player.coyote - dt);

  // 平台碰撞
  if (player.vy > 0) {
    const prevY = player.y - player.vy * dt;
    for (const p of platforms) {
      if (player.x + 12 > p.x && player.x - 12 < p.x + p.w &&
          prevY <= p.y && player.y >= p.y) {
        if (p.type === 'bad') {
          // 雷云破碎，坠落
          const i = platforms.indexOf(p);
          platforms.splice(i, 1);
          shake = Math.max(shake, 5);
          darkBurst(p.x + p.w / 2, p.y, 10);
          playBreak();
          break;
        }
        player.y = p.y;
        player.vy = 0;
        player.onPlatform = true;
        player.coyote = COYOTE;
        if (p.type === 'lotus') {
          // 墨莲弹跳
          player.vy = -(JUMP_MAX * LOTUS_BOUNCE);
          player.onPlatform = false;
          player.coyote = 0;
          splash(player.x, player.y, 10, 0.7);
          playJump();
        }
        break;
      }
    }
    if (player.onPlatform) {
      // 站在台上仍受重力检测——若平台被移除等情形
    }
  }

  // 印章收集
  for (const s of seals) {
    if (s.taken) continue;
    const dx = player.x - s.x;
    const dy = (player.y - 26) - s.y;
    if (Math.hypot(dx, dy) < 48) {
      s.taken = true;
      sealBurst(s.x, s.y);
      playSeal();
      updateHud(true);
    }
  }

  // 相机（只向上）
  const targetCam = player.y - H * 0.55;
  if (targetCam < camY) camY = targetCam;

  // 高度与里程碑
  const h = Math.max(0, -player.y / PPM);
  if (Math.floor(h) > height) {
    height = Math.floor(h);
    updateHud(false);
    if (height >= nextMilestone) {
      showToast('⛰ 登高 ' + nextMilestone + ' 米');
      playMilestone();
      nextMilestone += 100;
    }
  }

  // 坠亡
  if (player.y - camY > H + KILL_OFFSET) {
    if (demo) {
      // 菜单演示：坠落则重新登场，保持背景生动
      player.x = W / 2;
      player.y = camY + H * 0.5;
      player.vy = 0;
      player.onPlatform = false;
      player.coyote = 0.2;
      platforms.push(makePlatform(player.x - 46, player.y, 92, 'cloud'));
    } else {
      die();
    }
  }
}

function updateDrift(dt) {
  for (const p of platforms) {
    if (p.type !== 'drift') continue;
    p.x += p.vx * dt;
    if (p.x < 4 || p.x + p.w > W - 4) { p.vx *= -1; p.x = clamp(p.x, 4, W - 4 - p.w); }
  }
}

/* ---------------- 演示 AI（菜单背景自动登高） ---------------- */
function demoAI(dt) {
  if (!player.onPlatform) return;
  player.charging = true;
  let next = null;
  for (const p of platforms) {
    if (p.y < player.y - 40 && (!next || p.y > next.y)) next = p;
  }
  if (next) steerX = next.x + next.w / 2;   // 蓄力期间持续对准目标
  player.charge = clamp01(player.charge + dt / CHARGE_TIME);
  if (player.charge >= 1) doJump();
}

/* 向上补充平台（随相机生成） */
function generatePlatforms() {
  let genY = platforms.length ? platforms[platforms.length - 1].y : 0;
  let lastX = platforms.length ? platforms[platforms.length - 1].x : W / 2;
  while (genY > camY - 340) {
    genY -= rand(95, 125) + Math.min(height * 0.35, 130);
    const maxStep = Math.min(150 + (0 - genY) * 0.35, 230);
    const w = rand(64, 110);
    const x = clamp(lastX + rand(-maxStep, maxStep), 10, W - 10 - w);
    const type = pickType();
    const p = makePlatform(x, genY, w, type, type === 'drift' ? rand(-36, 36) : 0);
    platforms.push(p);
    if (Math.random() < 0.42 && type !== 'bad') {
      seals.push({ x: x + w / 2 + rand(-12, 12), y: genY - 48, taken: false });
    }
    lastX = x;
  }
}

/* ---------------- 流程 ---------------- */
function die() {
  if (state !== 'playing') return;
  state = 'dying';
  overReason = 'fall';
  playDie();
  splash(player.x, player.y, 14, 0.5);
  setTimeout(() => {
    if (state !== 'dying') return;
    state = 'over';
    showOver();
  }, 1000);
}

function showOver() {
  if (overShown) return;
  overShown = true;
  const isRecord = height > best;
  if (isRecord) {
    best = height;
    try { localStorage.setItem(KEY_BEST, String(best)); } catch (e) { /* 忽略 */ }
  }
  elFinal.textContent = height;
  elOverBest.textContent = best;
  elNewRecord.classList.toggle('hidden', !isRecord);
  elOverTitle.textContent = overReason === 'fall' ? '坠入云海' : '游戏结束';
  show(overEl, true);
  updateHud();
}

function startGame() {
  ensureAudio();
  demo = false;
  overShown = false;
  initWorld();
  state = 'playing';
  show(menuEl, false);
  show(pauseEl, false);
  show(overEl, false);
  playStart();
}

function showMenu() {
  demo = true;
  initWorld();
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
  elHeight.textContent = height;
  elBest.textContent = best;
  const taken = seals.filter(s => s.taken).length;
  elSeals.textContent = '印章 ' + taken;
  if (popScore) {
    elHeight.classList.remove('pop');
    void elHeight.offsetWidth;
    elHeight.classList.add('pop');
  }
}

/* ---------------- 粒子 ---------------- */
function splash(x, y, n, power) {
  for (let i = 0; i < n; i++) {
    const ang = Math.PI + rand(0, Math.PI);   // 向下喷射的墨滴
    const sp = rand(30, 90) * (0.5 + power);
    particles.push({
      kind: 'drop',
      x, y,
      vx: Math.cos(ang) * sp + rand(-20, 20),
      vy: Math.sin(ang) * sp * 0.7,
      life: 0, max: rand(0.3, 0.6),
      size: rand(1.5, 4) * (0.6 + power),
      hue: 40,
    });
  }
}

function sealBurst(x, y) {
  for (let i = 0; i < 16; i++) {
    const ang = Math.random() * TAU;
    const sp = rand(40, 160);
    particles.push({
      kind: 'drop',
      x, y,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp - 60,
      life: 0, max: rand(0.35, 0.7),
      size: rand(1.5, 3.5),
      hue: 0,      // 朱砂红
    });
  }
  particles.push({ kind: 'ring', x, y, r: 4, vr: 130, life: 0, max: 0.4, hue: 0 });
}

function darkBurst(x, y, n) {
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * TAU;
    const sp = rand(40, 140);
    particles.push({
      kind: 'drop', x, y,
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      life: 0, max: rand(0.3, 0.55), size: rand(2, 5), hue: 260,
    });
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += dt;
    if (p.life >= p.max) { particles.splice(i, 1); continue; }
    if (p.kind === 'drop') {
      p.vy += 900 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    } else {
      p.r += p.vr * dt;
      p.vr *= Math.max(0, 1 - dt * 4);
    }
  }
}

/* ---------------- 绘制 ---------------- */
function drawMountainLayer(baseY, amp, freq, seed, alpha) {
  ctx.fillStyle = `rgba(74,70,63,${alpha})`;
  ctx.beginPath();
  ctx.moveTo(0, H + 10);
  for (let x = 0; x <= W; x += 8) {
    const y = baseY
      + Math.sin(x * freq + seed) * amp
      + Math.sin(x * freq * 2.7 + seed * 2) * amp * 0.4;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W, H + 10);
  ctx.closePath();
  ctx.fill();
}

function drawMountains() {
  const layers = [
    { f: 0.1, amp: 26, base: H * 0.52, alpha: 0.10, seed: 1.7 },
    { f: 0.16, amp: 34, base: H * 0.64, alpha: 0.16, seed: 4.2 },
    { f: 0.24, amp: 40, base: H * 0.78, alpha: 0.24, seed: 8.9 },
  ];
  for (const L of layers) {
    const shift = camY * L.f * 0.6;
    drawMountainLayer(L.base + shift, L.amp, L.f, L.seed, L.alpha);
  }
}

function drawMist() {
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (let k = 0; k < 3; k++) {
    const my = ((k * H * 0.3 + time * (14 + k * 6)) % (H + 220)) - 110;
    const mx = Math.sin(time * 0.1 + k * 2) * 40;
    ctx.beginPath();
    ctx.ellipse(W / 2 + mx, my, W * 0.62, 26, 0, 0, TAU);
    ctx.fill();
  }
}

function drawBirds() {
  ctx.strokeStyle = 'rgba(60,58,55,0.6)';
  ctx.lineWidth = 1.6;
  for (let k = 0; k < 3; k++) {
    const bx = ((k * 0.37 + time * (0.03 + k * 0.012)) % 1.3) * W - W * 0.15;
    const by = H * (0.16 + k * 0.06) + Math.sin(time * 0.8 + k) * 14;
    const flap = Math.sin(time * 6 + k * 2) * 5;
    ctx.beginPath();
    ctx.moveTo(bx - 9, by + flap);
    ctx.quadraticCurveTo(bx - 3, by - 6, bx, by);
    ctx.quadraticCurveTo(bx + 3, by - 6, bx + 9, by + flap);
    ctx.stroke();
  }
}

function drawPlatform(p) {
  const sx = p.x, sy = p.y - camY;
  const cx = sx + p.w / 2;
  ctx.save();
  if (p.type === 'cloud') {
    ctx.fillStyle = 'rgba(235,230,220,0.95)';
    ctx.strokeStyle = 'rgba(120,110,95,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(cx, sy, p.w * 0.5, 9, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    // 云纹
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.ellipse(cx - p.w * 0.16, sy - 2, p.w * 0.22, 5, 0, 0, TAU);
    ctx.fill();
  } else if (p.type === 'stone') {
    ctx.fillStyle = 'rgba(90,86,78,0.9)';
    ctx.beginPath();
    ctx.moveTo(sx + 4, sy);
    ctx.lineTo(sx + p.w * 0.3, sy - 8);
    ctx.lineTo(sx + p.w * 0.7, sy - 5);
    ctx.lineTo(sx + p.w - 3, sy);
    ctx.lineTo(sx + p.w - 8, sy + 8);
    ctx.lineTo(sx + 6, sy + 8);
    ctx.closePath();
    ctx.fill();
  } else if (p.type === 'lotus') {
    ctx.fillStyle = 'rgba(84,80,72,0.92)';
    ctx.beginPath();
    ctx.ellipse(cx, sy, p.w * 0.5, 8, 0, 0, TAU);
    ctx.fill();
    // 红莲
    ctx.fillStyle = '#c2453c';
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU + Math.PI / 2;
      ctx.beginPath();
      ctx.ellipse(cx + Math.cos(a) * 6, sy - 4 + Math.sin(a) * 4, 5, 3, a, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#f0d8c8';
    ctx.beginPath(); ctx.arc(cx, sy - 4, 3, 0, TAU); ctx.fill();
  } else if (p.type === 'bad') {
    ctx.fillStyle = 'rgba(60,58,66,0.9)';
    ctx.beginPath();
    ctx.ellipse(cx, sy, p.w * 0.5, 10, 0, 0, TAU);
    ctx.fill();
    // 电光
    if ((time * 2) % 3 < 0.25) {
      ctx.strokeStyle = 'rgba(180,190,255,0.9)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(cx - 8, sy - 6);
      ctx.lineTo(cx + 2, sy + 2);
      ctx.lineTo(cx - 2, sy + 2);
      ctx.lineTo(cx + 9, sy + 10);
      ctx.stroke();
    }
  } else { // drift 游云
    ctx.fillStyle = 'rgba(222,217,206,0.9)';
    ctx.strokeStyle = 'rgba(120,110,95,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(cx, sy, p.w * 0.5, 8, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.ellipse(cx + p.w * 0.1, sy - 2, p.w * 0.2, 4, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawSeal(s) {
  const sy = s.y - camY + Math.sin(time * 2 + s.x) * 3;
  ctx.save();
  ctx.translate(s.x, sy);
  ctx.rotate(-0.06);
  ctx.fillStyle = '#c2453c';
  ctx.fillRect(-9, -9, 18, 18);
  ctx.strokeStyle = 'rgba(253,246,236,0.9)';
  ctx.lineWidth = 2;
  ctx.strokeRect(-9, -9, 18, 18);
  // 简笔「福」
  ctx.strokeStyle = '#fdf6ec';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-4, -5); ctx.lineTo(4, -5); ctx.lineTo(4, -3); ctx.lineTo(-4, -3);
  ctx.moveTo(0, -3); ctx.lineTo(0, 5);
  ctx.moveTo(-4, 0); ctx.lineTo(4, 0);
  ctx.moveTo(-4, 3); ctx.lineTo(3, 3);
  ctx.stroke();
  ctx.restore();
}

function drawPlayer() {
  const sy = player.y - camY;
  const charge = player.charging ? player.charge : 0;
  // 蓄力墨池
  if (charge > 0.05) {
    ctx.fillStyle = `rgba(40,38,40,${(0.25 * charge).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(player.x, sy, 10 + charge * 16, 4 + charge * 6, 0, 0, TAU);
    ctx.fill();
  }
  // 身体（墨点）
  ctx.fillStyle = '#33323a';
  ctx.beginPath();
  ctx.ellipse(player.x, sy - 16, 9, 11, 0, 0, TAU);
  ctx.fill();
  // 斗笠
  const hatY = sy - 26 - charge * 2;
  ctx.fillStyle = '#4a463f';
  ctx.beginPath();
  ctx.moveTo(player.x - 14, hatY);
  ctx.quadraticCurveTo(player.x, hatY - 12, player.x + 14, hatY);
  ctx.quadraticCurveTo(player.x, hatY - 5, player.x - 14, hatY);
  ctx.fill();
  ctx.fillStyle = '#33323a';
  ctx.beginPath();
  ctx.arc(player.x, hatY - 2, 2.6, 0, TAU);
  ctx.fill();
  // 朝向（简笔眼睛）
  const dir = Math.sign(player.vx) || 1;
  ctx.fillStyle = 'rgba(253,246,236,0.9)';
  ctx.beginPath();
  ctx.arc(player.x + dir * 3.5, sy - 17, 1.6, 0, TAU);
  ctx.fill();
  // 脚边墨痕
  ctx.fillStyle = 'rgba(40,38,40,0.35)';
  ctx.beginPath();
  ctx.ellipse(player.x, sy, 11, 2.6, 0, 0, TAU);
  ctx.fill();
}

function drawParticles() {
  for (const p of particles) {
    const k = 1 - p.life / p.max;
    if (p.kind === 'drop') {
      const c = p.hue === 0 ? '194,69,60' : p.hue === 260 ? '70,66,60' : '70,66,60';
      ctx.fillStyle = `rgba(${c},${(0.8 * k).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y - camY, p.size * k, 0, TAU);
      ctx.fill();
    } else {
      ctx.strokeStyle = `rgba(194,69,60,${(0.7 * k).toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y - camY, p.r, 0, TAU);
      ctx.stroke();
    }
  }
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (shake > 0.4) {
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    shake *= 0.85;
  }
  // 宣纸底
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#f7f2e3');
  g.addColorStop(1, '#f1ead6');
  ctx.fillStyle = g;
  ctx.fillRect(-20, -20, W + 40, H + 40);
  drawMountains();
  drawMist();
  drawBirds();
  for (const p of platforms) drawPlatform(p);
  for (const s of seals) if (!s.taken) drawSeal(s);
  drawPlayer();
  drawParticles();
  ctx.restore();
}

/* ---------------- 输入 ---------------- */
function startPress() {
  ensureAudio();
  if (state === 'menu' || state === 'over') {
    startGame();
    return true;
  }
  if (state === 'playing') {
    player.charging = true;
  }
  return false;
}

function startRelease() {
  if (state !== 'playing') return;
  if (player.charging) {
    player.charging = false;
    if (player.onPlatform || player.coyote > 0) {
      doJump();
    }
  }
}

canvas.addEventListener('pointerdown', (e) => {
  const rect = canvas.getBoundingClientRect();
  steerX = e.clientX - rect.left;
  startPress();
});
window.addEventListener('pointermove', (e) => {
  const rect = canvas.getBoundingClientRect();
  steerX = e.clientX - rect.left;
});
window.addEventListener('pointerup', startRelease);
window.addEventListener('pointercancel', startRelease);

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  steerX = e.changedTouches[0].clientX - rect.left;
  startPress();
}, { passive: false });
window.addEventListener('touchmove', (e) => {
  const rect = canvas.getBoundingClientRect();
  steerX = e.changedTouches[0].clientX - rect.left;
}, { passive: true });
window.addEventListener('touchend', startRelease);

window.addEventListener('keydown', (e) => {
  const k = e.key;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(k)) e.preventDefault();
  if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') {
    if (state === 'menu' || state === 'over') startGame();
    else if (state === 'playing') player.charging = true;
  }
  if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = true;
  if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = true;
  if (k === 'p' || k === 'P' || k === 'Escape') {
    if (state === 'playing') setPaused(true);
    else if (state === 'paused') setPaused(false);
  }
  if (k === 'Enter') {
    if (state === 'menu' || state === 'over') startGame();
  }
});
window.addEventListener('keyup', (e) => {
  const k = e.key;
  if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') startRelease();
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
  try { localStorage.setItem('ink-leap-muted', muted ? '1' : '0'); } catch (e) { /* 忽略 */ }
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
    updatePlayer(dt);
    updateDrift(dt);
    cullWorld();
    generatePlatforms();
  } else if (state === 'menu') {
    updatePlayer(dt);
    updateDrift(dt);
    cullWorld();
    generatePlatforms();
    demoAI(dt);
  }

  updateParticles(dt);
  draw();
}

/* ---------------- 调试钩子 ---------------- */
window.__gameDebug = () => ({
  state, demo,
  x: player.x, y: player.y, vy: player.vy,
  charging: player.charging, charge: player.charge,
  onPlatform: player.onPlatform,
  height, seals: seals.filter(s => s.taken).length,
  best, platforms: platforms.map(p => ({ x: p.x, y: p.y, w: p.w, type: p.type })),
  overReason,
});
window.__gameTest = {
  jump(charge01) {
    if (state === 'playing' && (player.onPlatform || player.coyote > 0)) {
      player.charge = clamp01(charge01);
      doJump();
    }
  },
  teleportSeal(i) {
    const untaken = seals.filter(s => !s.taken);
    const s = untaken[i] || untaken[0];
    if (s) { player.x = s.x; player.y = s.y + 46; player.vy = 0; }
  },
  landOn(i) {
    const p = platforms[i];
    if (p) { player.x = p.x + p.w / 2; player.y = p.y; player.vy = 0; }
  },
  spawnPlatform(x, y, w, type) {
    platforms.push(makePlatform(x, y, w, type, type === 'drift' ? 0 : 0));
  },
  fall() { player.y = camY + H + 100; },
};

/* ---------------- 初始化 ---------------- */
resize();
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
initWorld();
elMenuBest.textContent = best;
muteBtn.textContent = muted ? '🔇' : '🔊';
show(menuEl, true);
if (new URLSearchParams(location.search).has('autoplay')) startGame();
requestAnimationFrame(frame);

})();
