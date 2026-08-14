/* ============================================================
   双身迷宫 · 时间幽灵 — Node 逻辑冒烟测试
   运行：node test.js（依赖 ../../tools/dom_stub.js）
   ============================================================ */
'use strict';
const path = require('path');
const { makeGameEnv, makeReporter } = require(path.join(__dirname, '..', '..', 'tools', 'dom_stub.js'));

const GAME = path.join(__dirname, 'game.js');
const IDS = ['game','level','phase','gems','best','menuBest','overBest','finalScore','overTitle',
  'newRecord','toast','menu','pause','over','muteBtn','pauseBtn','startBtn','resumeBtn',
  'restartBtn','menuBtn','backLink'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const TICK_FRAMES = 8;   // 一步 ≈ 8 帧（16.7ms × 8 ≈ 0.133s）

/** 按住方向键直到到达目标格（抗帧漂移） */
function moveTo(env, key, tx, ty, maxFrames = 400) {
  env.win.dispatch('keydown', { key, preventDefault() {} });
  let reached = false;
  for (let i = 0; i < maxFrames; i++) {
    env.frames(1);
    const p = env.dbg().player;
    if (p.x === tx && p.y === ty) { reached = true; break; }
  }
  env.win.dispatch('keyup', { key, preventDefault() {} });
  return reached;
}

/** 原地站立 n 步（释放按键，让历史推进） */
function stand(env, ticks) {
  env.frames(ticks * TICK_FRAMES);
}

(async () => {
  const t = makeReporter();
  const env = makeGameEnv({ gameJs: GAME, ids: IDS });

  /* ---- 1. 加载为菜单态，关卡 1 ---- */
  let d = env.dbg();
  t.check('1  加载后为 menu', d.state === 'menu', 'state=' + d.state);
  t.check('2  关卡 1 已加载', d.level === 1, 'level=' + d.level);

  /* ---- 2. 开始游戏 ---- */
  env.key(' ');
  t.check('3  空格开始后为 playing', env.dbg().state === 'playing');
  t.check('4  玩家在起点 (2,1)', env.dbg().player.x === 2 && env.dbg().player.y === 1);

  /* ---- 3. 回声延迟：幽灵 20 步后到达同一格 ---- */
  moveTo(env, 'ArrowRight', 3, 1);
  t.check('5  向右一步到 (3,1)', env.dbg().player.x === 3 && env.dbg().player.y === 1);
  t.check('6  幽灵尚在起点（延迟未到）', env.dbg().ghost.x === 2 && env.dbg().ghost.y === 1,
    'ghost=' + JSON.stringify(env.dbg().ghost));
  stand(env, 22);
  d = env.dbg();
  t.check('7  延迟过后幽灵到达 (3,1)', d.ghost.x === 3 && d.ghost.y === 1,
    'ghost=' + JSON.stringify(d.ghost));

  /* ---- 4. 关卡 1 通关（含宝石）→ 进入关卡 2 ---- */
  moveTo(env, 'ArrowRight', 7, 1);   // 途经宝石 (5,1)
  d = env.dbg();
  t.check('8  途经宝石已收集 (1/1)', d.gems === 1 && d.gemsTotal === 1, 'gems=' + d.gems);
  t.check('9  HUD 宝石同步', env.els.gems.textContent.includes('1/1'), env.els.gems.textContent);
  moveTo(env, 'ArrowDown', 7, 2);
  moveTo(env, 'ArrowDown', 7, 3);    // 进入出口
  d = env.dbg();
  t.check('10 通关后进入关卡 2', d.level === 2, 'level=' + d.level);

  /* ---- 5. 关卡 2：门在无板时阻挡 ---- */
  env.run('window.__gameTest.warp(5, 3)');
  const blocked = !moveTo(env, 'ArrowRight', 6, 3, 60);
  t.check('12 闸门未开时被阻挡', blocked, 'player=' + JSON.stringify(env.dbg().player));

  /* ---- 6. 关卡 2：踩板 → 幽灵接力 → 过门 → 出口 ---- */
  env.run('window.__gameTest.warp(2, 1)');
  moveTo(env, 'ArrowRight', 7, 1);      // 到压力板
  t.check('13 站上压力板', env.dbg().player.x === 7 && env.dbg().player.y === 1);
  stand(env, 26);                        // 站立 ≥ 20 步，让幽灵接力
  moveTo(env, 'ArrowLeft', 1, 1);
  moveTo(env, 'ArrowDown', 1, 3);
  moveTo(env, 'ArrowRight', 6, 3);       // 此刻闸门应已开启
  t.check('14 幽灵接力后通过闸门 (6,3)', env.dbg().player.x === 6 && env.dbg().player.y === 3,
    'player=' + JSON.stringify(env.dbg().player));
  moveTo(env, 'ArrowRight', 8, 3);
  moveTo(env, 'ArrowDown', 8, 4);
  moveTo(env, 'ArrowLeft', 5, 4);        // 出口
  d = env.dbg();
  t.check('15 完成关卡 2 → 关卡 3', d.level === 3, 'level=' + d.level);

  /* ---- 7. 激光致死 ---- */
  env.run('window.__gameTest.loadLevel(4)');
  env.run('window.__gameTest.warp(2, 3)');
  moveTo(env, 'ArrowRight', 3, 3);
  d = env.dbg();
  t.check('16 踩激光进入 dying', d.state === 'dying', 'state=' + d.state);
  await sleep(1200);
  d = env.dbg();
  t.check('17 结算「信号丢失」', d.state === 'over' && d.overReason === 'laser',
    'state=' + d.state + ' reason=' + d.overReason);
  t.check('18 结算标题正确', env.els.overTitle.textContent === '信号丢失', env.els.overTitle.textContent);

  /* ---- 8. 重试本关 ---- */
  env.key(' ');
  d = env.dbg();
  t.check('19 空格重试回本关 (level 5)', d.state === 'playing' && d.level === 5,
    'state=' + d.state + ' level=' + d.level);

  /* ---- 9. 通关（胜利）---- */
  env.run('window.__gameTest.completeLevel()');
  d = env.dbg();
  t.check('20 通关后进入 over', d.state === 'over' && d.overReason === 'win',
    'state=' + d.state + ' reason=' + d.overReason);
  t.check('21 胜利标题「通关」', env.els.overTitle.textContent.includes('通关'), env.els.overTitle.textContent);
  t.check('22 最高分写入 localStorage', parseInt(env.localStorage.getItem('ghostecho-best') || '0', 10) >= d.score);

  /* ---- 10. 暂停 / 恢复 ---- */
  env.els.restartBtn.dispatch('click', {});
  t.check('23 重试按钮回到 playing', env.dbg().state === 'playing');
  env.key('p');
  t.check('24 P 键暂停', env.dbg().state === 'paused');
  const scorePaused = env.dbg().score;
  env.frames(300);
  t.check('25 暂停期间分数不变', env.dbg().score === scorePaused);
  env.key('p');
  t.check('26 再次 P 恢复', env.dbg().state === 'playing');

  /* ---- 11. 静音 ---- */
  env.els.muteBtn.dispatch('click', {});
  t.check('27 静音写入 localStorage', env.localStorage.getItem('ghostecho-muted') === '1');

  t.finish();
})();
