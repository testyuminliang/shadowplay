# nail.try — 虚拟美甲试戴 POC 迁移文档

> **文档维护约定：** 每推进一步（debug / 迁移 / 新功能）都回来更新本文件，保持与代码同步。
> 最近更新：2026-06-24 — 加入 Cloud Run 部署 workflow 骨架（占位待填）；接入 Git 仓库。

## 代码仓库

- **Remote：** `git@github.com-test:testyuminliang/nailtest.git`（SSH 别名 `github.com-test`，独立 key `~/.ssh/id_test_github`）
- **默认分支：** `main`
- **首个提交：** `30aea4b` — POC（含 v6–v9 修复）+ 验证套件 + README + 本文档
- **仓库结构：**
  ```
  nailtest/
  ├── README.md          ← 启动 / 验证命令
  ├── files/             ← 核心 POC + 启动脚本 + 本迁移文档
  └── verify/            ← Puppeteer 无头浏览器验证套件（node_modules 已 gitignore）
  ```
- **推送：** `git push origin main`（仓库非 git 起始，已 `git init` + 加 remote）。`verify/*.js` 的 Chrome 路径已改为 `process.env.CHROME_PATH` 可覆盖，便于他人运行。

## CI/CD — Cloud Run 部署 workflow（骨架，占位待填）

`.github/workflows/deploy-cloudrun.yml` —— **已搭架子，尚未可用**，等 Cloud Run 名字/位置定了再填。

- **现状：** Cloud Run 服务名、地区都没定，文件里用占位值 + `TODO【待定】` 注释标出。
- **触发：** 默认只 `workflow_dispatch`（手动）；占位填好后取消注释里的 `push: branches:[main]` 开启自动部署。
- **占位变量（env，定了改这里）：** `GCP_PROJECT_ID`、`SERVICE_NAME`、`REGION`。
- **认证：** 主用 Workload Identity Federation（免密钥，需 secrets `WIF_PROVIDER` / `GCP_DEPLOY_SA`）；注释里留了 SA JSON key 的替代写法。
- **构建/部署：** 主路径用 `deploy-cloudrun@v2` 的 **source 部署**（仓库根 Dockerfile 经 Cloud Build 构建，免手动管 Artifact Registry）；注释里留了「显式 docker build + push 到 AR」的替代 job。
- **就绪前置：** 启用 Cloud Run/Cloud Build/Artifact Registry API；部署 SA 角色 `run.admin` + `cloudbuild.builds.editor` + `artifactregistry.writer` + `iam.serviceAccountUser` + `storage.admin`；仓库根需有 Dockerfile（草稿见下方「第五步」）。
- 与下方「第五步：部署」里的 `cloudbuild.yaml` 是**两条等价路线**：现选用 GitHub Actions 这条，cloudbuild.yaml 作为 Cloud Build 直连的备选保留。

## 项目背景

我们要做一个**在线虚拟美甲试戴 WebApp**，用户打开电脑摄像头，系统识别手指并实时在指甲位置覆盖美甲效果。美甲会随手部动作一起运动，识别不到指甲盖的角度则不展示。

### 两种试戴方式
1. **素材库选择** — 从预设的 3~5 张美甲 PNG 中选择试戴（POC 阶段纯前端，无需后端）
2. **用户上传 → AI 生成** — 用户上传美甲照片，AI 识别样式并生成可用于试戴的甲片素材

### 技术约束（比赛/项目要求）
- 必须集成 **Google Cloud 产品**
- 使用 **Gemini 3.5 Flash**（多模态理解上传图片）
- 使用 **Imagen 3**（生成甲片素材）
- 最终部署到 **Google Cloud Run**

---

## 确定的技术栈

| 层级 | 技术 | 理由 |
|------|------|------|
| 框架 | **Next.js 14 (App Router)** | API Routes 当轻量后端，前端 SSR/CSR 灵活切换 |
| 手部识别 | **MediaPipe Hands (Web)** | 浏览器端运行，无需服务端推理，延迟低 |
| 甲片渲染 | **Canvas 2D** | POC 够用，仿射变换贴图 |
| 素材库 | **静态 PNG + JSON** | 3~5 张，无需数据库 |
| AI 识别 | **Gemini 3.5 Flash** via `@google/genai` | 多模态理解上传图片 |
| AI 生图 | **Imagen 3** via `@google/genai` | 生成甲片素材 |
| 部署 | **Google Cloud Run** | 容器化 Next.js，自动伸缩 |
| CI/CD | **Cloud Build** | push 触发构建部署 |

---

## POC 核心：手部追踪 + 甲片覆盖

### 当前实现（单文件 `nail-tryon-poc.html`）

一个自包含的 HTML 文件，用 `<script>` 标签加载 MediaPipe，不依赖构建工具，可直接通过 localhost 运行。

#### 技术细节

**MediaPipe 加载方式：**
```html
<!-- 经典 script 标签方式，比 ES module import 更稳定 -->
<script src="https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3/camera_utils.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/hands.js"></script>
```

> ⚠️ 最初尝试用 `@mediapipe/tasks-vision` 的 ES module import 方式，遇到 `Failed to fetch` 错误（WASM 文件加载失败），改用经典 `@mediapipe/hands` script 标签后解决。

**手指定义：**
```javascript
const FINGERS = [
  { name:'thumb',  pip:2,  dip:3,  tip:4,  w:0.72, l:0.60 },
  { name:'index',  pip:6,  dip:7,  tip:8,  w:0.55, l:0.60 },
  { name:'middle', pip:10, dip:11, tip:12, w:0.55, l:0.62 },
  { name:'ring',   pip:14, dip:15, tip:16, w:0.52, l:0.60 },
  { name:'pinky',  pip:18, dip:19, tip:20, w:0.48, l:0.55 },
];
// w = 宽度比例（相对 DIP→TIP 段长度）
// l = 长度比例（相对 DIP→TIP 段长度）
```

**指甲位置计算：**
- 中心点：DIP 到 TIP 的 72% 处（可通过 Pos 滑块调节 55%~90%）
- 角度：`atan2(tipY - dipY, tipX - dipX)`
- 大小：基于 DIP→TIP 像素距离 × 比例系数 × 全局缩放

**可见性判断（当前版本，v5 简化可靠逻辑）：**
```javascript
// 1. DIP→TIP 段长度太短 → 手指指向摄像头，跳过
if (seg < 12) continue;

// 2. tip.z - dip.z > 0.04 → 指尖在 DIP 后面（手指向远离摄像头方向弯曲）
if (tip.z - dip.z > 0.04) continue;

// 3. 指尖离 MCP 太近 → 完全握拳
if (tipMcpDist < 0.04) continue;
```

**Canvas 镜像：**
- video 和 canvas 都通过 CSS `transform: scaleX(-1)` 翻转
- landmark 坐标直接使用原始值（不手动翻转 x），这样坐标自动对齐

**甲片形状（Bezier 曲线路径）：**
```javascript
ctx.bezierCurveTo(rx*0.5, ry*0.82, rx*0.85, ry*0.6, rx*0.92, ry*0.1);  // 甲根→侧边
ctx.bezierCurveTo(rx*0.96, -ry*0.3, rx*0.8, -ry*0.8, rx*0.35, -ry);    // 侧边→指尖
ctx.quadraticCurveTo(0, -ry*1.08, -rx*0.35, -ry);                        // 指尖弧
// ...对称的左半部分
```

**光泽效果：**
- 窄竖高光椭圆（模拟甲油反光）
- 宽柔光椭圆（漫反射）
- 甲根处暗色阴影椭圆（甲缘感）

---

## 迭代历史与经验教训

### v1 — 初版
- 用 `@mediapipe/tasks-vision` ES module import
- **问题：** `Failed to fetch` — WASM 文件加载在部分浏览器/网络下失败
- **教训：** 经典 script 标签比 ES module 更稳定

### v2 — 修复加载 + 基础优化
- 改用 `@mediapipe/hands` + `@mediapipe/camera_utils` script 标签
- 加了 CSS `scaleX(-1)` 镜像（video + canvas 同时翻转）
- 每根手指独立的宽高比例
- **问题：** 甲片太大、太圆、位置有偏移
- **教训：** 手动翻转 `(1-x)` 在不同分辨率下不可靠，CSS 翻转更一致

### v3 — 掌心/手背检测
- 加了手掌法线方向检测（wrist→indexMCP × wrist→pinkyMCP 叉积）
- 掌心朝镜头时隐藏全部甲片
- **问题：** 用户要求猫爪姿势或者别的掌心朝前但手指弯曲能识别指甲盖时也要显示
- **教训：** 全局掌心检测太粗暴，需要更细粒度的判断

### v4 — 逐指法线检测（失败）
- 为每根手指计算独立的指甲表面法线
- 用 DIP→TIP 和 PIP→DIP 两次叉积
- **问题：** 完全检测不到手指了
- **教训：** MediaPipe 的 z 坐标是相对深度，精度不够做可靠的 3D 法线计算。过度复杂的算法在这种半 3D 数据上反而不如简单规则

### v5 — 回退到可靠逻辑 + UI 重设计
- 回到 v2 的简单可见性判断
- 去掉全局掌心检测（允许所有方向）
- 缩小默认甲片大小（Size 50%, Width 70%）
- 用 Bezier 曲线画更真实的甲片形状
- UI 改为轻柔明亮风格（DM Sans + Playfair Display 字体，暖白背景）
- 加了 Width 独立滑块
- **遗留问题：** 反馈「html 无法启动 / 还是有点问题」，待 v6 排查

### v6 — 调试与修复（2026-06-24，当前版本）
用无头 Chrome（puppeteer）实际加载页面跑了一遍，结论：**页面本身能正常启动**——localhost 与 file:// 两种方式下，MediaPipe 模型都能加载到 "Ready"、摄像头能开、甲片能渲染、无任何 JS 异常。真正的问题是下面两个 bug：

- **Bug 1：三个滑块全部失效（已修复）**
  - 现象：拖动 Size / Width / Pos，数字标签会变，但甲片完全不动。
  - 根因：滑块回调写的是 `window[cfg.state] = v/100`，但 `sizeScale`/`widthScale`/`nailOffset` 是顶层 `let` 声明。**顶层 `let` 不是 `window` 的属性**，于是 `window.sizeScale` 是个全新的幽灵全局，而渲染函数读的还是那个没被改动的 `let` 绑定。
  - 修复：改成用 setter 直接赋值真正的绑定 `{ set: v => { sizeScale = v/100; } }`。
  - 验证：Size 从 30 调到 100，甲片绘制像素从 136 → 1250（约 9×），滑块确实生效。

- **Bug 2：双击打开文件时，「请用 localhost 打开」的提示从不出现（已修复）**
  - 现象：直接双击 HTML（file:// 协议）→ 摄像头报一个含糊的权限错误，而不是引导用户去开本地服务器。
  - 根因：守卫写的是 `if (!window.isSecureContext)`，但 Chrome 把 `file://` 当作安全上下文（`isSecureContext === true`），所以这个守卫永远不触发。
  - 修复：守卫加上协议判断 `if (location.protocol === 'file:' || !window.isSecureContext)`。
  - 验证：file:// 下点击 Open Camera，现在会显示 "Secure context required" + localhost 指引，并跳过注定失败的 getUserMedia 调用。

- **迁移提示：** Bug 1 是「经典 script 全局变量」的坑——迁到 React 后这些会变成 `useState`/`useRef`，问题自然消失（这本来也是更对的写法）。Bug 2 在 `npm run dev`（localhost）下也不会出现，但若保留静态文件兜底入口，仍应保留协议/安全上下文守卫。

### v7 — 修复甲片系统性偏移（2026-06-24，当前版本）
用户截图反馈：甲片整体偏移，且**越靠画面边缘偏得越多**（大拇指那片直接飘到左下角，中指接近中心几乎对得上）。

- **根因：** video 用了 `object-fit: cover`（等比缩放覆盖面板、居中裁剪），但 canvas **没设 object-fit**，默认是 `fill`（把 1280×720 画布直接拉伸填满面板）。只要相机面板不是正好 16:9，两者坐标映射就对不上，误差在中心为 0、向两边线性增大。
- **几何验证（面板 800×600 为例）：** 水平误差从中心 0 增长到边缘 ±133px——与截图完全吻合。
- **修复：** 给 `.camera-panel canvas` 也加 `object-fit: cover`。canvas 内部分辨率已设为视频原始尺寸（1280×720），所以 cover 的裁剪方式与 video 完全一致，坐标自动对齐。
- **无头浏览器验证：** `fill` 时误差 +141 ~ −125px（随位置变化）；改 `cover` 后误差变成**恒定值**（边缘增长消失），对齐问题解决。
- **遗留：** 甲片在指甲上的细微高低位置可用 Pos 滑块微调；甲片偏圆/偏大、掌心方向仍是后续项。

### v8 — 拇指侧棱角度处理 + 甲形微调（2026-06-24，当前版本）
用户反馈：手侧过来时，**大拇指甲片仍然奇怪**（一坨半透明圆饼赖在拇指旁）。

- **根因（几何限制，非 bug）：** 四指竖起时我们看到的是指甲背面、朝向相机，贴图天然对齐；但拇指甲朝向侧面，手一侧过来，拇指末节（IP→TIP，即 landmark 3→4）就指向/背向相机，看到的是指甲**侧棱**而非指甲面。这正是 v4 记录的「MediaPipe z 精度不足以做可靠 3D 法线」的同一限制。
- **旧逻辑的问题：** 原 fade 把这种侧棱角度的透明度**钳在 0.4 下限**，从不真正隐藏，所以拇指变成一坨半透明圆饼。
- **修复 1（侧棱即隐藏）：** 去掉 0.4 下限，改为「`|Δz|` 越大越淡，`fadeAlpha < 0.3` 就直接 `continue` 不画」。对应需求「识别不到指甲盖的角度则不展示」。斜率 13、阈值 0.3 是经验值，可眼调。
- **修复 2（甲形改窄）：** 拇指 `w:0.72→0.60`、`l:0.60→0.64`，宽度收窄、长度略增，不再是圆饼，即使露出来也更像指甲。
- **无头浏览器验证：** 拇指 tip.z=−0.12（侧棱）→ 拇指绘制像素 0（隐藏），四指正常；拇指 tip.z=0（正对）→ 拇指 198（显示），四指不受影响。
- **遗留：** 阈值是写死的经验值，不同人/距离可能要再调；更彻底的方案仍是指甲分割模型或 Gemini 实时区域检测。

### v9 — 时序平滑消抖 + Smooth 滑块（2026-06-24，当前版本）
用户反馈：①甲片不够精细 ②侧面角度仍会显示/闪烁 ③手不动时甲片有轻微抖动。

- **根因（同一个天花板）：** MediaPipe Hands 只输出 21 个**关节点**，没有「指甲」概念，甲片是从 DIP→TIP 这根骨头**推算**出来的；而且模型每帧重新估计 landmark，静止手也会抖 ±几 px，之前我们直接画**原始坐标**、零平滑，所以抖动、闪烁全暴露出来。
- **做法（Path 1，实时方案）：**
  - 接入 **One Euro 滤波器**（Casiez et al.，低延迟自适应平滑：慢时重平滑消抖、快时放开跟手）。
  - 对每根手指的 `dip.x/y`、`tip.x/y`（归一化坐标）和 `zDelta = tip.z - dip.z` 做平滑，按 **手性(Left/Right)+手指名** keyed 各自独立。
  - zDelta 也平滑 → 侧面可见性判断不再逐帧抖 → 缓解「侧面闪烁」。
  - 新增 **Smooth 滑块**（0=关/原始，100=最强），可实时调抖动↔跟手延迟的平衡；默认 60。
  - 默认 **Size 50→46、Width 70→60**，甲片更贴合、不再溢出指缘。
- **无头浏览器验证：** 模拟静止手 ±0.004 归一化抖动，连续 90 帧（含 30 帧预热）测「绘制甲片中心」的跨帧 stddev：Smooth=0 时 x=2.32/y=1.36px，Smooth=85 时 x=0.56/y=0.31px → **抖动降约 4×**，且仍跟手。
- **遗留：** One Euro 的 `minCutoff/beta` 默认是经验值，可继续微调；这仍是「关节推算」而非像素级——真正精细见下方里程碑。

---

## 后续里程碑：像素级精度（指甲分割方向，未实现）

> 这是 v9 之后的「更精细」方向，先记录给方向，**暂不实现**。

**为什么现方案有天花板：** MediaPipe 只给 21 关节点，甲片是从一根骨头向量推算的贝塞尔形状，**永远贴不到真实甲缘**。要做到像素级贴合，需要真正「看见」指甲区域。

**方向 A — 自训练指甲分割模型（推荐主线）**
- 小型分割网络（U-Net / DeepLabv3-mobile），输出每个指甲的像素 mask。
- 用现有 landmarks 先定位每指 ROI（DIP→TIP 周围裁一小块），**只在 ROI 上跑分割**，大幅降算力、提精度。
- Web 端推理：TF.js / ONNX Runtime Web / MediaPipe Image Segmenter（自定义 .tflite）。
- 数据：需要带指甲 mask 标注的手部图像（自采 + 标注，或找公开数据集）；这是最大成本项，要先搞数据。

**方向 B — 中间档（轻量、过渡）**
- 不做分割，但把**素材库的甲片 PNG**用透视/仿射变换贴到 landmark 推算的甲片四角，替代当前纯 Canvas 画的形状——比贝塞尔更真实，工作量远小于分割。可作为分割落地前的过渡。

**实时性注意：** Web 端逐帧分割可能掉帧 → 降分辨率、ROI-only、跳帧 + 用 v9 的平滑层做帧间插值。

**与现有方案的关系：** landmarks 仍负责**定位 ROI 与朝向**，分割只负责**精修甲形与边缘**；v9 的 One Euro 平滑层继续复用在分割结果上。

---

## 已知问题 & 待解决

### ✅ 摄像头权限（已处理）
- `file://` 协议下浏览器不允许摄像头访问
- 必须通过 `localhost` 或 HTTPS 打开
- 已加入错误提示和 `start-server.sh` / `start-server.bat` 脚本
- **v6 修复：** 守卫现在正确识别 `file://`（之前 `isSecureContext` 对 file:// 返回 true 导致提示失效）
- 迁移到 Next.js 后 `npm run dev` 自带 localhost，此问题自然消失

### ✅ 滑块失效（v6 已修复）
- 之前 Size / Width / Pos 三个滑块拖动无效（写到了幽灵 `window` 属性上）
- 已改为 setter 直接赋值 `let` 绑定，验证生效

### ✅ 甲片系统性偏移（v7 已修复）
- 之前甲片整体偏移、越靠边偏得越多（canvas 默认 `fill` 拉伸，与 video 的 `cover` 裁剪不一致）
- 已给 canvas 加 `object-fit: cover`，验证边缘误差从 ±133px 降为恒定值

### 甲片对齐精度（细节，仍可优化）
- MediaPipe landmarks 是关节中心点，不是指甲表面
- 当前用 DIP→TIP 的 72% 处作为甲片中心，大致对齐但不精确（可用 Pos 滑块微调）
- **后续方向：** 可以训练专门的指甲分割模型，或用 Gemini 做实时指甲区域检测

### 掌心方向处理
- 当前版本不区分掌心/手背，所有方向都显示甲片
- 掌心完全朝镜头且手指伸直时，甲片会显示在错误的一面
- **v3 的叉积方案是对的方向**，但需要更柔和的处理：不是全局隐藏，而是降低透明度或根据角度调整

### 甲片大小
- 仍然偏大，需要用户通过滑块微调到合适值后固定为默认值（**v6 修复滑块后这条才真正可调**）
- 不同手大小、不同距离的自适应还没做

---

## 文件清单

```
当前交付物/
├── nail-tryon-poc.html    ← 核心 POC（自包含，可单独运行）
├── start-server.sh        ← Mac/Linux 启动本地服务器脚本
├── start-server.bat       ← Windows 启动本地服务器脚本
└── MIGRATION.md           ← 本文档
```

---

## 迁移到 Next.js 项目的计划

### 第一步：项目脚手架
```bash
npx create-next-app@14 nail-try-on --typescript --tailwind --app --src-dir
cd nail-try-on
npm install @mediapipe/hands @mediapipe/camera_utils
```

### 第二步：迁移核心组件
将 `nail-tryon-poc.html` 中的逻辑拆分为：

```
src/
├── app/
│   ├── page.tsx                 ← 主页
│   └── api/generate-nail/
│       └── route.ts             ← AI 生成甲片 API
├── components/
│   ├── CameraView.tsx           ← 摄像头 + MediaPipe + Canvas
│   ├── NailRenderer.ts          ← 甲片渲染逻辑（drawSingleNail）
│   ├── HandTracker.ts           ← MediaPipe 初始化 + 可见性判断
│   ├── NailGallery.tsx          ← 素材库选择面板
│   ├── UploadPanel.tsx          ← 上传图片面板
│   └── ControlSliders.tsx       ← Size/Width/Pos 滑块（注意：用 useState，不要重蹈 v6 的全局绑定坑）
├── lib/
│   ├── nail-config.ts           ← 手指配置、默认参数
│   └── gemini.ts                ← Gemini + Imagen API 封装
├── public/
│   └── nails/                   ← 静态甲片素材 PNG
│       ├── rose.png
│       ├── lavender.png
│       ├── coral.png
│       ├── gradient-pink-blue.png
│       └── pearl.png
├── Dockerfile
└── cloudbuild.yaml
```

### 第三步：素材库（同事负责）
每张甲片素材要求：
- 透明背景 PNG
- 单个指甲盖，略微俯视角度
- 建议尺寸 200×300px
- 可选：配套 JSON 配置（锚点、默认缩放）

### 第四步：AI 生成甲片
```
用户上传美甲照片
       ↓
API Route 调用 Gemini 2.5 Flash (multimodal)
  → 分析美甲样式（颜色、图案、形状）
  → 生成结构化描述 JSON
       ↓
API Route 调用 Imagen 3 (Vertex AI)
  → 按描述生成透明背景单甲片 PNG
       ↓
返回前端 → 进入试戴流程
```

SDK: `@google/genai`（一个 SDK 同时调 Gemini 和 Imagen）

### 第五步：部署
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

```yaml
# cloudbuild.yaml
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', 'gcr.io/$PROJECT_ID/nail-try-on', '.']
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', 'gcr.io/$PROJECT_ID/nail-try-on']
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    args: ['gcloud', 'run', 'deploy', 'nail-try-on',
           '--image', 'gcr.io/$PROJECT_ID/nail-try-on',
           '--region', 'asia-northeast1',
           '--allow-unauthenticated']
```

---

## UI 设计方向

- **风格：** 轻柔明亮，暖白背景 `#fdf9f7`
- **字体：** Playfair Display（Logo）+ DM Sans（正文）
- **主色：** 柔粉 `#e8889e`
- **布局：** 左侧摄像头主区域 + 右侧 sidebar（素材库 + 上传）+ 底部控制栏
- **色板：** 4 列网格，选中态带 ✓ 标记 + 粉色边框

---

## 关键代码片段参考

### MediaPipe 初始化
```javascript
const mpHands = new Hands({
  locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${f}`
});
mpHands.setOptions({
  maxNumHands: 2,
  modelComplexity: 1,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.5,
});
```

### Camera 循环
```javascript
new Camera(video, {
  onFrame: async () => {
    await mpHands.send({ image: video });
  },
  width: 1280, height: 720,
}).start();
```

### 可见性判断（简化可靠版）
```javascript
const seg = Math.hypot(tipX - dipX, tipY - dipY);
if (seg < 12) continue;                    // 段太短
if (tip.z - dip.z > 0.04) continue;        // z-depth 弯曲
if (tipMcpDist < 0.04) continue;            // 握拳
```

### 滑块绑定（v6 修复版 — 直接写 `let` 绑定，勿写 `window[...]`）
```javascript
const sliders = {
  sizeSlider:   { set: v => { sizeScale  = v / 100; }, valId:'sizeVal' },
  widthSlider:  { set: v => { widthScale = v / 100; }, valId:'widthVal' },
  offsetSlider: { set: v => { nailOffset = v / 100; }, valId:'offsetVal' },
};
for (const [id, cfg] of Object.entries(sliders)) {
  document.getElementById(id).addEventListener('input', e => {
    const v = parseInt(e.target.value);
    cfg.set(v);
    document.getElementById(cfg.valId).textContent = v;
  });
}
```

### 甲片 Bezier 路径
```javascript
ctx.moveTo(0, ry * 0.82);
ctx.bezierCurveTo(rx*0.5, ry*0.82, rx*0.85, ry*0.6, rx*0.92, ry*0.1);
ctx.bezierCurveTo(rx*0.96, -ry*0.3, rx*0.8, -ry*0.8, rx*0.35, -ry);
ctx.quadraticCurveTo(0, -ry*1.08, -rx*0.35, -ry);
// 对称左半部分...
```
