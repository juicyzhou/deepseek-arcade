/* ============================================================
   星噬 · 黑洞吞噬 — Node 逻辑冒烟测试
   运行：node test.js（依赖 ../../tools/dom_stub.js）
   ============================================================ */
'use strict';
const path = require('path');
const { makeGameEnv, makeReporter } = require(path.join(__dirname, '..', '..', 'tools', 'dom_stub.js'));

const GAME = path.join(__dirname, 'game.js');
const IDS = ['game','mass','rank','best','menuBest','overBest','finalMass','overRank','overTitle',
  'newRecord','toast','timerBar','menu','pause','over','muteBtn','pauseBtn','startBtn','resumeBtn',
  'restartBtn','menuBtn','backLink'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmt = m => m >= 10000 ? (m / 10000).toFixed(1) + '万' : m >= 1000 ? (m / 1000).toFixed(1) + 'k' : String(Math.round(m));

/** 朝目标点带避障地牵引（每次迭代 3 帧） */
function steerTo(env, tx, ty, steps) {
  for (let i = 0; i < steps; i++) {
    const dbg = env.dbg();
    if (dbg.state !== 'playing' || !dbg.player) return false;
    const dx = tx - dbg.player.x, dy = ty - dbg.player.y;
    const d = Math.hypot(dx, dy);
    if (d < 16) return true;
    let blocker = null, bd = Infinity;
    const scan = (ox, oy, or, extra) => {
      const t2 = Math.max(0, Math.min(1, (dx * (ox - dbg.player.x) + dy * (oy - dbg.player.y)) / (d * d)));
      const cx2 = dbg.player.x + dx * t2, cy2 = dbg.player.y + dy * t2;
      const dist = Math.hypot(ox - cx2, oy - cy2);
      if (dist < or + dbg.radius + extra && dist < bd) { bd = dist; blocker = { x: ox, y: oy }; }
    };
    for (const b of dbg.bodies) if (b.r > dbg.radius * 1.12) scan(b.x, b.y, b.r, 26);
    for (const h of dbg.holesList) if (!h.isPlayer && h.r > dbg.radius * 1.1) scan(h.x, h.y, h.r, 30);
    let wx = tx, wy = ty;
    if (blocker) {
      const ang = Math.atan2(dy, dx) + (blocker.y > dbg.player.y ? -0.95 : 0.95);
      wx = dbg.player.x + Math.cos(ang) * 130;
      wy = dbg.player.y + Math.sin(ang) * 130;
    }
    env.pointer('pointerdown', wx, wy);
    env.win.dispatch('pointermove', { clientX: wx, clientY: wy, preventDefault() {} });
    env.frames(3);
    env.win.dispatch('pointerup', { clientX: wx, clientY: wy, preventDefault() {} });
  }
  return false;
}

/** 直接牵引（不避障，用于开局拖拽 / 自杀测试） */
function dragDirect(env, tx, ty, steps) {
  for (let i = 0; i < steps; i++) {
    const dbg = env.dbg();
    if (dbg.state !== 'playing') return;
    env.pointer('pointerdown', tx, ty);
    env.win.dispatch('pointermove', { clientX: tx, clientY: ty, preventDefault() {} });
    env.frames(4);
    env.win.dispatch('pointerup', { clientX: tx, clientY: ty, preventDefault() {} });
  }
}

(async () => {
  const t = makeReporter();
  const env = makeGameEnv({ gameJs: GAME, ids: IDS });

  /* ---- 1. 加载为菜单态，实体齐全 ---- */
  let d = env.dbg();
  t.check('1  加载后为 menu', d.state === 'menu', 'state=' + d.state);
  t.check('2  黑洞数 >= 4（玩家+3 AI）', d.holes >= 4, 'holes=' + d.holes);
  t.check('3  环境天体 >= 10', d.bodies.length >= 10, 'n=' + d.bodies.length);
  t.check('4  玩家存在且质量>0', d.player !== null && d.mass > 0, 'mass=' + d.mass);

  /* ---- 2. 开始游戏 + 计时器 ---- */
  env.key(' ');
  d = env.dbg();
  t.check('5  空格开始后为 playing', d.state === 'playing', 'state=' + d.state);
  const t0 = d.timer;
  env.frames(60);
  t.check('6  计时器随时间递减', env.dbg().timer < t0, t0 + ' -> ' + env.dbg().timer.toFixed(1));

  /* ---- 3. 拖拽牵引移动（出生保护期内，安全） ---- */
  const px0 = env.dbg().player.x;
  dragDirect(env, px0 + 320, env.dbg().player.y, 26);
  t.check('7  拖拽后玩家向右移动', env.dbg().player.x > px0 + 20, px0.toFixed(0) + ' -> ' + env.dbg().player.x.toFixed(0));

  /* ---- 4. 确定性吞噬：在玩家位置生成小天体 → 真实碰撞吞噬 ---- */
  const massBefore = env.dbg().mass;
  const p = env.dbg().player;
  env.run(`window.__gameTest.spawnBodyAt(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, 8)`);
  env.frames(6);
  d = env.dbg();
  t.check('8  吞噬后质量增大', d.mass > massBefore + 10, massBefore.toFixed(0) + ' -> ' + d.mass.toFixed(0));
  t.check('9  HUD 质量与内部同步', env.els.mass.textContent === fmt(d.mass), env.els.mass.textContent + ' vs ' + fmt(d.mass));
  t.check('10 排名显示含 /4', env.els.rank.textContent.includes('/4'), env.els.rank.textContent);

  /* ---- 5. 暂停 / 恢复 ---- */
  t.check('11 当前仍在 playing', env.dbg().state === 'playing', 'state=' + env.dbg().state);
  env.key(' ');
  t.check('12 空格暂停', env.dbg().state === 'paused');
  const massPaused = env.dbg().mass;
  env.frames(300);
  t.check('13 暂停期间质量不变', env.dbg().mass === massPaused);
  env.key(' ');
  t.check('14 再次空格恢复', env.dbg().state === 'playing');

  /* ---- 6. 撞上更大的天体 → 死亡 ---- */
  env.run('window.__gameFastForward(999)');
  if (env.dbg().state !== 'playing') env.key(' ');   // over → 重开
  t.check('15 重开后为 playing', env.dbg().state === 'playing');
  env.run('window.__gameTest.noInvuln()');           // 立即解除出生保护

  let crushed = false;
  for (let i = 0; i < 1200 && !crushed; i++) {
    const dbg = env.dbg();
    if (dbg.state === 'dying' || dbg.state === 'over') { crushed = true; break; }
    let big = null, bigR = 0;
    for (const b of dbg.bodies) {
      if (b.r > dbg.radius * 1.2 && b.r > bigR) { bigR = b.r; big = b; }
    }
    if (!big) { env.frames(9); continue; }
    dragDirect(env, big.x, big.y, 4);
  }
  t.check('16 撞上大天体进入 dying/over', crushed, 'state=' + env.dbg().state);
  await sleep(1300);
  d = env.dbg();
  t.check('17 结算浮层显示（over）', d.state === 'over', 'state=' + d.state);
  t.check('18 结算标题为「被撕裂了」', env.els.overTitle.textContent === '被撕裂了', env.els.overTitle.textContent);
  t.check('19 结算质量文本正确', env.els.finalMass.textContent === fmt(d.mass));
  t.check('20 最佳质量已写入 localStorage', parseInt(env.localStorage.getItem('singularity-best-mass') || '0', 10) >= Math.round(d.mass));
  t.check('21 结算层可见', !env.els.over.classList.contains('hidden'));

  /* ---- 7. 时间到结算 ---- */
  env.key(' ');
  t.check('22 重开为 playing', env.dbg().state === 'playing');
  env.run('window.__gameFastForward(91)');
  d = env.dbg();
  t.check('23 快进 91s 触发时间到结算', d.state === 'over' && d.overReason === 'time', 'state=' + d.state + ' reason=' + d.overReason);
  t.check('24 时间到标题正确', env.els.overTitle.textContent === '时间到', env.els.overTitle.textContent);

  /* ---- 8. 返回菜单 ---- */
  env.els.menuBtn.dispatch('click', {});
  t.check('25 主菜单按钮回到 menu', env.dbg().state === 'menu');

  /* ---- 9. 静音持久化 ---- */
  env.els.muteBtn.dispatch('click', {});
  t.check('26 静音状态写入 localStorage', env.localStorage.getItem('singularity-muted') === '1');

  t.finish();
})();
