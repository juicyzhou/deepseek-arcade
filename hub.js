/* ============================================================
   流光游戏厅 · 大厅数据与渲染
   ============================================================ */
(() => {
'use strict';

const GAMES = [
  {
    id: 'snake', href: 'games/snake/', title: '流光贪吃蛇',
    desc: '极光丝带蛇在星海游弋 · 平滑插值 · 粒子吞星',
    genre: '经典街机', emoji: '🐍', g1: '#22d3ee', g2: '#a855f7', ready: true,
  },
  {
    id: 'singularity', href: 'games/singularity/', title: '星噬 · 黑洞吞噬',
    desc: '引力牵引黑洞 · 吞噬成长 · 与 AI 黑洞竞逐',
    genre: '物理养成', emoji: '🕳️', g1: '#6366f1', g2: '#ec4899', ready: true,
  },
  {
    id: 'inkleap', href: 'games/ink-leap/', title: '踏云行 · 水墨跳山',
    desc: '蓄力跳跃 · 水墨晕染 · 印章金币 · 无限登高',
    genre: '跳跃跑酷', emoji: '🖌️', g1: '#64748b', g2: '#0ea5e9', ready: true,
  },
  {
    id: 'orbital', href: 'games/orbital/', title: '星环守卫 · 轨道哨兵',
    desc: '360° 环形防御 · 护盾弹反 · 连击攒分',
    genre: '反应防御', emoji: '🪐', g1: '#8b5cf6', g2: '#f472b6', ready: true,
  },
  {
    id: 'ghostecho', href: 'games/ghost-echo/', title: '双身迷宫 · 时间幽灵',
    desc: '彩排路线 · 过去身同步回放 · 自我配合解谜',
    genre: '时间解谜', emoji: '👻', g1: '#06b6d4', g2: '#d946ef', ready: true,
  },
  {
    id: 'pulsestar', href: 'games/pulse-star/', title: '星流节拍 · 音浪共振',
    desc: 'WebAudio 实时合成音游 · 节拍判定 · 极光爆发',
    genre: '节奏音游', emoji: '🎵', g1: '#f59e0b', g2: '#ec4899', ready: true,
  },
];

const grid = document.getElementById('grid');
GAMES.forEach((g, i) => {
  const a = document.createElement('a');
  a.className = 'card' + (g.ready ? '' : ' coming');
  if (g.ready) a.href = g.href;
  a.style.setProperty('--g1', g.g1);
  a.style.setProperty('--g2', g.g2);
  a.innerHTML = `
    <div class="cover">
      <span class="emoji">${g.emoji}</span>
      <span class="status ${g.ready ? 'ready' : ''}">${g.ready ? '可玩' : '开发中'}</span>
    </div>
    <div class="info">
      <h3>${g.title}</h3>
      <p>${g.desc}</p>
      <span class="chip">${g.genre}</span>
    </div>`;
  grid.appendChild(a);
});

})();
