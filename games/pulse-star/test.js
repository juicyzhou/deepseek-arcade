/* ============================================================
   星流节拍 · 音浪共振 — Node 逻辑冒烟测试
   运行：node test.js（依赖 ../../tools/dom_stub.js）
   ============================================================ */
'use strict';
const path = require('path');
const { makeGameEnv, makeReporter } = require(path.join(__dirname, '..', '..', 'tools', 'dom_stub.js'));

const GAME = path.join(__dirname, 'game.js');
const IDS = ['game','score','combo','life','best','menuBest','overBest','finalScore','overTitle',
  'newRecord','toast','menu','pause','over','muteBtn','pauseBtn','startBtn','resumeBtn',
  'restartBtn','menuBtn','backLink'];

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const t = makeReporter();
  const env = makeGameEnv({ gameJs: GAME, ids: IDS });

  /* ---- 1. 加载为菜单态 ---- */
  let d = env.dbg();
  t.check('1  加载后为 menu', d.state === 'menu', 'state=' + d.state);
  t.check('2  初始五格生命', d.life === 5, 'life=' + d.life);

  /* ---- 2. 开始游戏，音符生成 ---- */
  env.key(' ');
  t.check('3  空格开始后为 playing', env.dbg().state === 'playing');
  env.frames(120);
  d = env.dbg();
  t.check('4  音符持续生成', d.notes.length > 0, 'notes=' + d.notes.length);

  /* ---- 3. Perfect 判定 ---- */
  const s0 = d.score;
  env.run('window.__gameTest.spawnNote(0, 10)');   // 10px ≈ 30ms → Perfect
  env.run('window.__gameTest.pressLane(0)');
  d = env.dbg();
  t.check('5  Perfect 命中（+300）', d.score >= s0 + 300, s0 + ' -> ' + d.score);
  t.check('6  连击 >= 1', d.combo >= 1, 'combo=' + d.combo);
  t.check('7  HUD 分数同步', env.els.score.textContent === String(d.score));

  /* ---- 4. Good 判定 ---- */
  const s1 = d.score;
  env.run('window.__gameTest.spawnNote(1, 20)');   // 20px ≈ 60ms → Good
  env.run('window.__gameTest.pressLane(1)');
  d = env.dbg();
  t.check('8  Good 命中（+100）', d.score >= s1 + 100, s1 + ' -> ' + d.score);

  /* ---- 5. 过早按键无效 → 音符漏接 ---- */
  env.run('window.__gameTest.spawnNote(2, 200)');  // 太远，按了也无效
  env.run('window.__gameTest.pressLane(2)');
  d = env.dbg();
  t.check('9  过早按键不判定', d.notes.some(n => n.lane === 2 && n.dist > 100), '音符仍在');
  env.frames(50);
  d = env.dbg();
  t.check('10 漏接音符 → 扣命 + 连击清零', d.life < 5 && d.combo === 0, 'life=' + d.life + ' combo=' + d.combo);

  /* ---- 6. 生命耗尽 → 星流紊乱 ---- */
  for (let i = 0; i < 8; i++) {
    env.run('window.__gameTest.spawnNote(' + (i % 4) + ', 8)');
    env.frames(20);
    if (env.dbg().state !== 'playing') break;
  }
  env.frames(10);
  d = env.dbg();
  t.check('11 生命耗尽进入 dying/over', d.state === 'dying' || d.state === 'over', 'state=' + d.state);
  await sleep(1300);
  d = env.dbg();
  t.check('12 结算浮层显示（over）', d.state === 'over', 'state=' + d.state);
  t.check('13 结算标题「星流紊乱」', env.els.overTitle.textContent === '星流紊乱', env.els.overTitle.textContent);
  t.check('14 结算分数文本正确', env.els.finalScore.textContent === String(d.score));
  t.check('15 最高分写入 localStorage', parseInt(env.localStorage.getItem('pulsestar-best') || '0', 10) >= d.score);
  t.check('16 结算层可见', !env.els.over.classList.contains('hidden'));

  /* ---- 7. 重开 + 极光爆发 ---- */
  env.key(' ');
  d = env.dbg();
  t.check('17 空格重开为 playing 且分数归零', d.state === 'playing' && d.score === 0,
    'state=' + d.state + ' score=' + d.score);
  env.run('window.__gameTest.fillEnergy()');
  env.run('window.__gameTest.spawnNote(0, 10)');
  env.run('window.__gameTest.pressLane(0)');
  d = env.dbg();
  t.check('18 能量满触发极光爆发', d.burst === true, 'burst=' + d.burst);
  const s2 = d.score;
  env.run('window.__gameTest.spawnNote(1, 10)');
  env.run('window.__gameTest.pressLane(1)');
  d = env.dbg();
  t.check('19 爆发期间 Perfect ×2（+600）', d.score >= s2 + 600, s2 + ' -> ' + d.score);

  /* ---- 8. 暂停 / 恢复 ---- */
  env.key(' ');
  t.check('20 空格暂停', env.dbg().state === 'paused');
  const scorePaused = env.dbg().score;
  env.frames(300);
  t.check('21 暂停期间分数不变', env.dbg().score === scorePaused);
  env.key(' ');
  t.check('22 再次空格恢复', env.dbg().state === 'playing');

  /* ---- 9. 静音 ---- */
  env.els.muteBtn.dispatch('click', {});
  t.check('23 静音写入 localStorage', env.localStorage.getItem('pulsestar-muted') === '1');

  t.finish();
})();
