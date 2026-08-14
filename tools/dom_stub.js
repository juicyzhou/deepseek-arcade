/* ============================================================
   流光游戏厅 · 共享测试桩（Node 环境模拟 DOM/Canvas）
   供各游戏 test.js 使用：node test.js
   ============================================================ */
'use strict';
const fs = require('fs');
const vm = require('vm');

function makeEl(id) {
  const listeners = {};
  const classSet = new Set(['hidden']);
  const el = {
    id,
    checked: false,
    style: {},
    offsetWidth: 100,
    _textContent: '',
    get textContent() { return el._textContent; },
    set textContent(v) { el._textContent = String(v); },
    classList: {
      add: c => classSet.add(c),
      remove: c => classSet.delete(c),
      toggle: (c, force) => {
        const v = force === undefined ? !classSet.has(c) : !!force;
        v ? classSet.add(c) : classSet.delete(c);
        return v;
      },
      contains: c => classSet.has(c),
    },
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    dispatch: (t, ev) => { (listeners[t] || []).forEach(fn => fn(ev)); },
    getBoundingClientRect: () => ({ width: 960, height: 640, left: 0, top: 0 }),
  };
  return el;
}

/**
 * 在隔离的 vm 环境中加载并运行游戏 JS，返回可控的测试句柄。
 * @param {object} opts
 * @param {string} opts.gameJs  game.js 绝对路径
 * @param {string[]} opts.ids   index.html 中所有元素的 id 列表
 * @param {string} [opts.search]  location.search（如 '?autoplay'）
 * @param {object} [opts.rect]   canvas 布局尺寸
 * @param {Function} [opts.audioCtor] 可选 AudioContext 桩构造器
 */
function makeGameEnv({ gameJs, ids, search = '', rect = { width: 960, height: 640 }, audioCtor } = {}) {
  const els = {};
  ids.forEach(id => { els[id] = makeEl(id); });

  const ctxProxy = new Proxy({}, {
    get(t, prop) {
      if (/gradient/i.test(prop)) return () => ({ addColorStop() {} });
      return () => undefined;
    },
    set() { return true; },
  });
  const canvas = els.game;
  canvas.getContext = () => ctxProxy;
  canvas.getBoundingClientRect = () => ({ ...rect, left: 0, top: 0 });

  const winListeners = {};
  const docListeners = {};
  const storage = {};

  const AC = audioCtor || class {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    createGain() { return { gain: { value: 0.5, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    createOscillator() {
      return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
               connect() {}, start() {}, stop() {} };
    }
    resume() { this.state = 'running'; }
  };

  const win = {
    devicePixelRatio: 1,
    addEventListener: (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); },
    dispatch: (t, ev) => { (winListeners[t] || []).forEach(fn => fn(ev)); },
    AudioContext: AC,
  };
  const doc = {
    hidden: false,
    getElementById: id => els[id] || null,
    addEventListener: (t, fn) => { (docListeners[t] = docListeners[t] || []).push(fn); },
  };
  const localStorage = {
    getItem: k => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
  };

  let rAFcb = null;
  const context = vm.createContext({
    window: win, document: doc, localStorage, location: { search },
    URLSearchParams, performance, console,
    setTimeout, clearTimeout,
    requestAnimationFrame: fn => { rAFcb = fn; return 0; },
  });
  vm.runInContext(fs.readFileSync(gameJs, 'utf8'), context, { filename: gameJs });

  const env = {
    els, win, doc, localStorage,
    now: performance.now(),
    rAF: () => rAFcb,
    /** 运行任意表达式（测试钩子/读调试状态） */
    run: expr => vm.runInContext(expr, context),
    /** 读取游戏调试快照（游戏需暴露 window.__gameDebug） */
    dbg: () => vm.runInContext('window.__gameDebug()', context),
    /** 向 window 派发键盘事件 */
    key: k => win.dispatch('keydown', { key: k, preventDefault() {} }),
    /** 向 canvas 派发指针/触屏事件（可携带坐标） */
    pointer: (type, x = 0, y = 0) => canvas.dispatch(type, {
      clientX: x, clientY: y, touches: [{ clientX: x, clientY: y }],
      changedTouches: [{ clientX: x, clientY: y }], preventDefault() {},
    }),
    /** 推进 n 帧（默认 16.7ms/帧） */
    frames(n, stepMs = 16.7) {
      for (let i = 0; i < n; i++) {
        env.now += stepMs;
        if (rAFcb) { const cb = rAFcb; rAFcb = null; cb(env.now); }
      }
    },
  };
  return env;
}

/** 简单的断言收集器 */
function makeReporter() {
  let failures = 0;
  return {
    check(name, cond, extra) {
      console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  [' + extra + ']' : ''));
      if (!cond) failures++;
    },
    finish() {
      console.log(failures ? `\n${failures} 项失败` : '\n全部通过 ✔');
      process.exit(failures ? 1 : 0);
    },
  };
}

module.exports = { makeGameEnv, makeReporter };
