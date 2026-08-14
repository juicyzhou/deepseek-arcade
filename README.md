# 🎮 流光游戏厅 · DeepSeek Arcade

> 6 款风格迥异的纯前端小游戏合集，**全部由 DeepSeek AI 在 deepseek-harness 中自动开发、测试并验证**。

## ✨ 项目介绍

**流光游戏厅（DeepSeek Arcade）** 是一个零依赖、纯前端的六合一游戏网站：
从极光星海的流光贪吃蛇，到引力黑洞吞噬、水墨登高、环形防御、回声解谜与合成音游——
六种截然不同的美学与玩法，一个大厅自由选择，即开即玩。

本项目最大的特别之处在于**生产方式**：全部代码、交互设计、测试用例与视觉风格，
均由 DeepSeek AI 在 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
环境中自动生成、自我审查并逐项验证——每款游戏都带有 Node 逻辑冒烟测试（26~27 项断言、
多轮稳定性复跑全绿）与无头浏览器截图 + 像素分析验证记录，**零手工编写、零第三方运行时依赖**。
它是「AI 原生软件开发」的完整可运行样例，也是 deepseek-harness 生态的一次趣味实践。

## 🎮 游戏列表

| # | 游戏 | 风格 | 类型 | 验证 |
| --- | --- | --- | --- | --- |
| 1 | 流光贪吃蛇 | 极光星海 · 流光丝带 | 经典街机 | ✅ 21 项测试 |
| 2 | 星噬 · 黑洞吞噬 | 深空 · 吸积盘 | 物理养成 | ✅ 26 项测试 ×5 稳定 |
| 3 | 踏云行 · 水墨跳山 | 国风水墨 | 跳跃跑酷 | ✅ 26 项测试 ×8 稳定 |
| 4 | 星环守卫 · 轨道哨兵 | 极简霓虹圆环 | 反应防御 | ✅ 24 项测试 ×6 稳定 |
| 5 | 双身迷宫 · 时间幽灵 | 赛博故障 | 时间解谜 | ✅ 27 项测试 ×5 稳定 |
| 6 | 星流节拍 · 音浪共振 | 放射霓虹 · 合成音游 | 节奏音游 | ✅ 23 项测试 ×5 稳定 |

## 🌐 部署为静态网站（GitHub Pages）

本项目为纯静态站点（无构建步骤），可直接部署：

```bash
# 1. 登录 GitHub（需要有效 token）
gh auth login

# 2. 创建仓库并推送
gh repo create deepseek-arcade --public --source . --push

# 3. 开启 GitHub Pages（部署 main 分支根目录）
gh api --method POST repos/:owner/deepseek-arcade/pages \
  -f "source[branch]=main" -f "source[path]=/"
```

也可在 GitHub 网页端操作：仓库 **Settings → Pages → Deploy from a branch → main → /**。

## 🗂️ 目录结构

```
├── index.html        # 游戏大厅（选择入口）
├── style.css         # 大厅样式
├── hub.js            # 大厅卡片渲染
├── tools/dom_stub.js # 共享测试桩（Node 模拟 DOM/Canvas）
└── games/
    ├── snake/        # 流光贪吃蛇
    ├── singularity/  # 星噬 · 黑洞吞噬
    ├── ink-leap/     # 踏云行 · 水墨跳山
    ├── orbital/      # 星环守卫 · 轨道哨兵
    ├── ghost-echo/   # 双身迷宫 · 时间幽灵
    └── pulse-star/   # 星流节拍 · 音浪共振
```

每个游戏独立可玩（`games/<名字>/index.html`），内含 `game.js`（引擎）、`style.css`（样式）、
`test.js`（Node 逻辑测试）与 `README.md`（玩法说明）。

## ▶️ 本地运行

```bash
# 方式一：直接双击 index.html
open index.html

# 方式二：本地静态服务器（推荐）
python3 -m http.server 8000
# 浏览器访问 http://localhost:8000
```

## 🧪 测试

```bash
node --check game.js      # 语法校验（每个游戏目录下）
node test.js              # 逻辑冒烟测试（基于 tools/dom_stub.js 桩环境）
```

## ✨ 技术底座（所有游戏共用）

- Canvas 2D · requestAnimationFrame 60fps · DPR 自适应 · 响应式
- WebAudio 程序化合成音效（零音频资源）
- localStorage 最高分记录
- 键盘 + 触屏双操作 · 中文界面 · 玻璃拟态 / 水墨 / 霓虹 / 故障风 UI
- 状态机：菜单（含演示）/ 进行 / 暂停 / 结算
- 每款游戏含调试钩子（`window.__gameDebug`）供自动化测试与检查
