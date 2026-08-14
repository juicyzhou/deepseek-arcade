/* ============================================================
   星环守卫 · 轨道哨兵 — Node 逻辑冒烟测试
   运行：node test.js（依赖 ../../tools/dom_stub.js）
   ============================================================ */
'use strict';
const path = require('path');
const { makeGameEnv, makeReporter } = require(path.join(__dirname, '..', '..', 'tools', 'dom_stub.js'));

const GAME = path.join(__dirname, 'game.js');
const IDS = ['game','score','combo','hearts','best','menuBest','overBest','finalScore','overTitle',
  'newRecord','toast','menu','pause','over','muteBtn','pauseBtn','startBtn','resumeBtn',
  'restartBtn','menuBtn','backLink'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const DEG = Math.PI / 180;

(async () => {
  const t = makeReporter();
  const env = makeGameEnv({ gameJs: GAME, ids: IDS });

  /* ---- 1. 加载为菜单态 ---- */
  let d = env.dbg();
  t.check('1  加载后为 menu', d.state === 'menu', 'state=' + d.state);
  t.check('2  初始三颗心', d.hearts === 3, 'hearts=' + d.hearts);

  /* ---- 2. 开始游戏 ---- */
  env.key(' ');
  t.check('3  空格开始后为 playing', env.dbg().state === 'playing');

  /* ---- 3. 键盘转动护盾 ---- */
  env.win.dispatch('keydown', { key: 'ArrowRight', preventDefault() {} });
  env.frames(30);
  env.win.dispatch('keyup', { key: 'ArrowRight', preventDefault() {} });
  d = env.dbg();
  t.check('4  按住 → 护盾顺时针转动', d.theta > 0.5, 'theta=' + d.theta.toFixed(2) + ' rad');

  /* ---- 4. 弹反陨石 ---- */
  env.run('window.__gameTest.setTheta(0)');
  env.run('window.__gameTest.spawnMeteor(0, 240, 150)');
  env.frames(40);
  d = env.dbg();
  t.check('5  护盾弹反陨石（分数>0）', d.score > 0, 'score=' + d.score);
  t.check('6  连击 >= 1', d.combo >= 1, 'combo=' + d.combo);
  t.check('7  HUD 分数同步', env.els.score.textContent === String(d.score));

  /* ---- 5. 未挡住的陨石 → 扣心 ---- */
  env.run('window.__gameTest.setTheta(180)');
  env.run('window.__gameTest.spawnMeteor(0, 240, 150)');
  env.frames(40);
  d = env.dbg();
  t.check('8  未挡住 → 扣心', d.hearts === 2, 'hearts=' + d.hearts);
  t.check('9  连击清零', d.combo === 0, 'combo=' + d.combo);
  t.check('10 HUD 红心同步', env.els.hearts.textContent === '♥♥♡', env.els.hearts.textContent);

  /* ---- 6. 三心耗尽 → 恒星湮灭 ---- */
  env.run('window.__gameTest.spawnMeteor(0, 240, 150)');
  env.run('window.__gameTest.spawnMeteor(0, 240, 150)');
  env.frames(40);
  d = env.dbg();
  t.check('11 三心耗尽进入 dying/over', d.state === 'dying' || d.state === 'over', 'state=' + d.state);
  await sleep(1400);
  d = env.dbg();
  t.check('12 结算浮层显示（over）', d.state === 'over', 'state=' + d.state);
  t.check('13 结算标题「恒星湮灭」', env.els.overTitle.textContent === '恒星湮灭', env.els.overTitle.textContent);
  t.check('14 结算分数文本正确', env.els.finalScore.textContent === String(d.score));
  t.check('15 最高分写入 localStorage', parseInt(env.localStorage.getItem('orbital-best') || '0', 10) >= d.score);
  t.check('16 结算层可见', !env.els.over.classList.contains('hidden'));

  /* ---- 7. 星尘扩展护盾 ---- */
  env.key(' ');
  t.check('17 重开为 playing', env.dbg().state === 'playing');
  const baseHalf = env.dbg().shieldHalf;
  env.run('window.__gameTest.setTheta(0)');
  env.run('window.__gameTest.spawnDust(0, 240)');
  env.frames(45);
  d = env.dbg();
  t.check('18 收集星尘后护盾扩展', d.shieldHalf > baseHalf, baseHalf.toFixed(1) + ' -> ' + d.shieldHalf.toFixed(1));
  t.check('19 护盾不超过上限', d.shieldHalf <= 65 * DEG + 0.001);

  /* ---- 8. 暂停 / 恢复 ---- */
  env.key(' ');
  t.check('20 空格暂停', env.dbg().state === 'paused');
  const scorePaused = env.dbg().score;
  env.frames(300);
  t.check('21 暂停期间分数不变', env.dbg().score === scorePaused);
  env.key(' ');
  t.check('22 再次空格恢复', env.dbg().state === 'playing');

  /* ---- 9. 重开重置 ---- */
  env.run('window.__gameTest.setTheta(180)');   // 护盾转开，确保陨石砸星
  env.run('window.__gameTest.spawnMeteor(0, 240, 150)');
  env.run('window.__gameTest.spawnMeteor(0, 240, 150)');
  env.run('window.__gameTest.spawnMeteor(0, 240, 150)');
  env.frames(40);
  await sleep(1400);
  env.key(' ');
  d = env.dbg();
  t.check('23 重开后分数归零、三心满', d.state === 'playing' && d.score === 0 && d.hearts === 3,
    'score=' + d.score + ' hearts=' + d.hearts);

  /* ---- 10. 静音 ---- */
  env.els.muteBtn.dispatch('click', {});
  t.check('24 静音写入 localStorage', env.localStorage.getItem('orbital-muted') === '1');

  t.finish();
})();
