# Talos Logo 设计方案

## 定位

Talos = 研发周期全自动流程平台。名称取自希腊神话中守护克里特岛的青铜自动机，隐喻「不知疲倦的守护与编排」。

## 概念：「Cycle T」

- **软圆角方（squircle）**：现代产品图标形态，小尺寸可读
- **靛→青紫渐变**：延续现有 design system 的 accent（`#4f46e5` 系）
- **弧形 T 横杠**：字母识别 + 周期弧线
- **轨道环**：研发闭环（采集 → 准入 → 编排 → 执行）
- **菱形节点**：流水线终点 / 交付

刻意去掉旧版「盾牌 + 对勾」——过于通用的安全 SaaS 语汇。

## 资产

| 文件 | 用途 |
|------|------|
| `web/public/favicon.svg` | 浏览器图标 |
| `web/public/brand/talos-mark.svg` | 独立标记 |
| `web/public/brand/talos-lockup.svg` | 横排 lockup |
| `web/src/icons.tsx` → `Mark` | 应用内品牌组件 |

## 不改动

- CSS 语义色 `--accent*` 保持不变
- 字标仍用产品字体 + 文案「Talos」，不引入新字体文件
