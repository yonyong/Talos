# Talos Logo 设计方案

## 定位

Talos = 研发周期全自动流程平台。名称取自希腊神话中守护克里特岛的青铜自动机，隐喻「不知疲倦的守护与编排」。

## 概念：「神盾 / Aegis」

以希腊神话 Talos 的「守护」属性为出发点，用「Aegis（神盾）」承载 Talos 首字母 **T**，作为品牌视觉主体。

- **盾形轮廓**：象征守护、稳定、可信；顶部微拱，底部收束成盾尖，整体圆润
- **深靛 → 靛 → 青紫渐变**：延续 design system accent，但更沉、更克制
- **T 字母为主体**：加粗几何 T 字置于盾心，强调品牌首字母，避免泛化的 SaaS 图形

## 资产

| 文件 | 用途 |
|------|------|
| `web/public/favicon.svg` | 浏览器图标 |
| `web/public/brand/talos-mark.svg` | 独立标记 |
| `web/public/brand/talos-lockup.svg` | 横排 lockup |
| `web/src/icons.tsx` → `Mark` | 应用内品牌组件 |
| `web/public/favicon.ico` | 兼容性 .ico |
| `web/public/favicon-192.png` | PWA 192px 图标 |
| `web/public/favicon-512.png` | PWA 512px 图标 |
| `web/public/apple-touch-icon.png` | iOS 主屏图标 |

## 不改动

- CSS 语义色 `--accent*` 保持不变
- 字标仍用产品字体 + 文案「Talos」
