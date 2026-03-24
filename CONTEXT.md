# 够级游戏 - 项目上下文

## 项目概述
- **类型**: 多人在线卡牌游戏（够级/山东传统扑克）
- **技术栈**: Node.js + Socket.IO + 纯HTML/CSS/JS（无框架）
- **入口**: `server.js`（后端）+ `public/index.html`（前端单文件）
- **部署**: PM2 管理，Cloudflare Tunnel 对外

## 文件结构
```
gouji-game/
├── server.js          # Express + Socket.IO 后端，游戏逻辑
├── public/
│   └── index.html     # 前端单文件（HTML+CSS+JS ~1800行）
├── package.json
└── CONTEXT.md         # 本文件
```

## 前端架构 (index.html)
- **CSS变量**: `--card-w: 68px`, `--card-h: 96px`
- **手牌布局**: 两排
  - Row1 (#handRow1): 10, J, Q, K, A, 小王, 大王
  - Row2 (#handRow2): 3-9
  - 两排重叠：Row2 wrapper 有 `margin-top: calc(var(--card-h) * -0.4)`，前低后高扇形
  - Row1 z-index:2, Row2 z-index:1
- **卡牌重叠**: 簇内70%重叠(同rank)，簇间用黄金比例(1.618x)间距
- **卡牌样式**: 
  - 白色渐变背景，圆角
  - 左上/右下角显示 rank + suit
  - 中心pips已全部隐藏(display:none)，保持干净牌面
  - 够级牌高亮：红色box-shadow + border（无🔥emoji）
- **关键函数**:
  - `renderHand()` → 分牌到两排 → `renderRowCards()` 
  - `buildPipsHTML()` → 已废弃（pips隐藏）
  - `renderCenter()` → 桌面中央出牌显示
  - `toggleCard()` → 选牌
  - `playCards()` / `passTurn()` / `hintCards()` → 操作按钮
- **规则面板**: 显示当前房间规则（炸弹/够级/进贡/革命等）

## 最近改动记录
- **2026-03-25 01:25**: 去掉所有🔥emoji（4处），卡牌中心pips全部隐藏，第二排牌重叠到第一排后方(40%高度)
- **2026-03-25 01:20**: 簇间距改为黄金比例驱动

## 待解决
- [ ] 移动端适配优化
- [ ] 出牌动画
- [ ] 音效

## 恢复上下文指南
Compact 后读这个文件即可恢复项目状态。修改代码后请同步更新本文件。
