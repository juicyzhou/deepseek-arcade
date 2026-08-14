/* ============================================================
   踏云行 · 水墨跳山 — Node 逻辑冒烟测试
   运行：node test.js（依赖 ../../tools/dom_stub.js）
   ============================================================ */
'use strict';
const path = require('path');
const { makeGameEnv, makeReporter } = require(path.join(__dirname, '..', '..', 'tools', 'dom_stub.js'));

const GAME = path.join(__dirname, 'game.js');
const IDS = ['game','height','seals','best','menuBest','overBest','finalHeight','overTitle',
  'newRecord','toast','menu','pause','over','muteBtn','pauseBtn','startBtn','resumeBtn',
  'restartBtn','menuBtn','backLink'];

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const t = makeReporter();
  const env = makeGameEnv({ gameJs: GAME, ids: IDS });

  /* ---- 1. 加载为菜单态，世界完整 ---- */
  let d = env.dbg();
  t.check('1  加载后为 menu', d.state === 'menu', 'state=' + d.state);
  t.check('2  平台已生成 >= 3', d.platforms.length >= 3, 'n=' + d.platforms.length);
  t.check('3  玩家存在且站在平台上', typeof d.y === 'number' && d.onPlatform === true);

  /* ---- 2. 菜单演示自动登高 ---- */
  env.frames(1500);
  d = env.dbg();
  t.check('4  菜单演示自动登高（height>5）', d.height > 5, 'height=' + d.height);

  /* ---- 3. 开始游戏 ---- */
  env.key(' ');
  t.check('5  空格开始后为 playing', env.dbg().state === 'playing');

  /* ---- 4. 蓄力 ---- */
  env.win.dispatch('keydown', { key: ' ', preventDefault() {} });
  env.frames(20);
  d = env.dbg();
  t.check('6  按住空格蓄力（charging）', d.charging === true);
  t.check('7  蓄力值随按住增长', d.charge > 0.3, 'charge=' + d.charge.toFixed(2));
  env.win.dispatch('keyup', { key: ' ', preventDefault() {} });

  /* ---- 5. 起跳与重力 ---- */
  d = env.dbg();
  t.check('8  松开起跳（vy<0）', d.vy < 0, 'vy=' + d.vy.toFixed(0));
  let fell = false;
  for (let i = 0; i < 150 && !fell; i++) {   // 时序无关：直到下落或落地
    env.frames(1);
    const dd = env.dbg();
    if (dd.vy > 0 || dd.onPlatform) fell = true;
  }
  d = env.dbg();
  t.check('9  重力回落（vy>0 或已落地）', fell, 'vy=' + d.vy.toFixed(0) + ' on=' + d.onPlatform);

  /* ---- 6. 指针操作登高（真实输入路径：按住→对准→松开 + 空中微调） ---- */
  let curKey = null;
  const steer = (dbg, tx) => {
    const need = dbg.x < tx - 4 ? 'ArrowRight' : dbg.x > tx + 4 ? 'ArrowLeft' : null;
    if (need !== curKey) {
      if (curKey) env.win.dispatch('keyup', { key: curKey, preventDefault() {} });
      if (need) env.win.dispatch('keydown', { key: need, preventDefault() {} });
      curKey = need;
    }
  };
  let climbed = false;
  for (let i = 0; i < 500 && !climbed; i++) {
    const dbg = env.dbg();
    if (dbg.state !== 'playing') break;
    if (dbg.height > 12) { climbed = true; break; }
    if (!dbg.onPlatform) { steer(dbg, dbg.x); env.frames(6); continue; }
    let next = null;
    for (const p of dbg.platforms) {
      if (p.y < dbg.y - 40 && (!next || p.y > next.y)) next = p;
    }
    if (!next) { env.frames(6); continue; }
    const tx = next.x + next.w / 2;
    env.pointer('pointerdown', tx, 0);
    env.win.dispatch('pointermove', { clientX: tx, clientY: 0, preventDefault() {} });
    env.frames(36);    // 蓄满（0.55s）
    env.win.dispatch('pointerup', { clientX: tx, clientY: 0, preventDefault() {} });
    for (let f = 0; f < 26; f++) {   // 飞行中方向键微调
      const dd = env.dbg();
      if (dd.state !== 'playing') break;
      steer(dd, tx);
      env.frames(1);
    }
  }
  if (curKey) env.win.dispatch('keyup', { key: curKey, preventDefault() {} });
  d = env.dbg();
  t.check('10 指针操作连续登高（height>12）', climbed && d.state === 'playing', 'height=' + d.height + ' state=' + d.state);

  /* ---- 7. 印章收集 ---- */
  if (env.dbg().state !== 'playing') env.key(' ');   // 若中途坠亡则重开
  const s0 = env.dbg().seals;
  env.run('window.__gameTest.teleportSeal(0)');
  env.frames(4);
  d = env.dbg();
  t.check('11 收集印章后计数+1', d.seals === s0 + 1, s0 + ' -> ' + d.seals);
  t.check('12 HUD 印章文本同步', env.els.seals.textContent.includes(String(d.seals)), env.els.seals.textContent);

  /* ---- 8. 雷云破碎 ---- */
  if (env.dbg().state !== 'playing') env.key(' ');
  const px = env.dbg().x, py = env.dbg().y;
  env.run(`window.__gameTest.spawnPlatform(${px}, ${py - 90}, 60, "bad")`);
  const badIdx = env.dbg().platforms.length - 1;
  const badBefore = env.dbg().platforms.filter(p => p.type === 'bad').length;
  env.run(`window.__gameTest.landOn(${badIdx})`);   // 放到雷云表面 → 真实碰撞判定
  env.frames(3);
  d = env.dbg();
  const badAfter = d.platforms.filter(p => p.type === 'bad').length;
  t.check('13 踩雷云后平台破碎（bad 平台减少）', badAfter < badBefore, badBefore + ' -> ' + badAfter);

  /* ---- 9. 正常平台可站立 ---- */
  const normalIdx = d.platforms.findIndex(p => p.type === 'cloud');
  if (normalIdx >= 0) {
    env.run(`window.__gameTest.landOn(${normalIdx})`);
    env.frames(3);
    t.check('14 落在祥云上可站立', env.dbg().onPlatform === true);
  } else {
    t.check('14 落在祥云上可站立', false, '无祥云');
  }

  /* ---- 10. 坠亡结算 ---- */
  env.run('window.__gameTest.fall()');
  env.frames(5);
  t.check('15 坠落进入 dying', env.dbg().state === 'dying', 'state=' + env.dbg().state);
  await sleep(1300);
  d = env.dbg();
  t.check('16 结算浮层显示（over）', d.state === 'over', 'state=' + d.state);
  t.check('17 结算标题「坠入云海」', env.els.overTitle.textContent === '坠入云海', env.els.overTitle.textContent);
  t.check('18 结算高度文本正确', env.els.finalHeight.textContent === String(d.height));
  t.check('19 最佳高度写入 localStorage', parseInt(env.localStorage.getItem('ink-leap-best') || '0', 10) >= d.height);
  t.check('20 结算层可见', !env.els.over.classList.contains('hidden'));

  /* ---- 11. 重开 ---- */
  env.key(' ');
  t.check('21 空格重开为 playing', env.dbg().state === 'playing');
  t.check('22 重开后高度归零', env.dbg().height === 0, 'height=' + env.dbg().height);

  /* ---- 12. 暂停 / 恢复 ---- */
  env.win.dispatch('keydown', { key: 'p', preventDefault() {} });
  t.check('23 P 键暂停', env.dbg().state === 'paused');
  const hPaused = env.dbg().height;
  env.frames(300);
  t.check('24 暂停期间高度不变', env.dbg().height === hPaused);
  env.win.dispatch('keydown', { key: 'p', preventDefault() {} });
  t.check('25 再次 P 恢复', env.dbg().state === 'playing');

  /* ---- 13. 静音 ---- */
  env.els.muteBtn.dispatch('click', {});
  t.check('26 静音写入 localStorage', env.localStorage.getItem('ink-leap-muted') === '1');

  t.finish();
})();
