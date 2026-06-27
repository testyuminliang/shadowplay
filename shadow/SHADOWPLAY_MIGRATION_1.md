# ShadowPlay AI（影戏）— 完整迁移文档

## 一句话产品定义

> **AI 生成互动绘本，你用手影扮演故事里的角色，跟着剧情一起翻页。**

---

## 实现进度（POC 验证）

| 步骤 | 状态 | 说明 |
|------|------|------|
| **① 手势 → 影子渲染** | ✅ 已验证 | `shadow/shadowplay-poc.html`：摄像头 → MediaPipe Hands → 骨骼胶囊剪影 → 暖色"墙壁"投影。已用合成 landmarks 注入 `onResults()` 跑通整条渲染链路（截图见 `verify/shadow-proof.png`，剪影 ~10.8 万像素、覆盖 11.8%、手形 bbox 652×530）。 |
| ② Gemini 生成故事 + 交互定义 | ⬜ 待做 | `/api/generate-story` |
| ③ Imagen 场景插图 | ⬜ 待做 | `/api/generate-image` |
| ④ 手势验证（learn_gesture） | ⬜ 待做 | landmarks/截图 → Gemini |
| ⑤ A→B 移动追踪 + 翻页 | ⬜ 待做 | 手中心坐标 → 命中目标 |
| ⑥ 绘本 UI 串联 + Cloud Run 部署 | ⬜ 待做 | |

### ① 已实现要点（与文档原方案的差异）

- **单文件 POC**：`shadow/shadowplay-poc.html`，零构建，采用稳定的 `@mediapipe/hands@0.4` script 标签 + `Camera` + One-Euro 平滑方案。
- **剪影合成改进**：文档原 `drawBoneShadow` 直接画半透明胶囊，关节重叠处会更黑、有接缝。改为先在**离屏 canvas 用纯黑不透明**画骨骼胶囊 + 手掌多边形 + 关节圆，再整体一次性 `ctx.filter=blur()` + `globalAlpha` 合成到主画布 → 统一柔边剪影，无接缝。
- **"墙壁"质感**：CSS 暖色径向渐变 + SVG 噪点纸纹；摄像头画面默认隐藏（可一键显示用于调试），所以呈现的是"真实投影"观感而非原始视频。
- **投影感**：剪影按 `影子大小` 放大、按 `光源偏移` 平移，模拟光源角度。控制条可实时调：影子大小 / 边缘柔化 / 浓度 / 光源偏移 / 平滑。
- **支持双手**（`maxNumHands:2`），蝴蝶等双手手势可用。

### 本地运行

```bash
cd shadow
python3 -m http.server 8090
# 打开 http://localhost:8090/shadowplay-poc.html → 点击"开启摄像头"
```

### 自动验证（无需真实摄像头）

```bash
cd verify
npm install          # 安装 puppeteer-core
node shadow.js       # 注入合成手部 landmarks，读回画布像素 + 截图 shadow-proof.png
```

---

## 项目背景

### 比赛信息
- **比赛**: Gemini AI Hackathon @Google Japan（AI Builders 主办）
- **日期**: 2026 年 6 月 28 日（周六）
- **地点**: Google Japan - Shibuya
- **时间线**:
  - 10:30 Workshop
  - 11:30 Hacking 开始
  - 16:30 Hacking 结束 → Live Demo（每队 2 分钟）
  - 17:30 颁奖
- **实际开发时间**: 约 5 小时
- **团队上限**: 6 人

### 审查基准
1. **Google Cloud 活用**（必须）: 项目必须使用 Gemini API / AI Studio / Antigravity / Vertex AI 等
2. **革新性**: I/O 2026 新功能（Managed Agents、多模态生成）加分
3. **完成度**: 能跑吗？能 demo 吗？

### 推荐技术栈（I/O 2026 发布）
- Gemini 3.5 Flash — 最快的 frontier model，适合 agent 工作流
- Managed Agents（Gemini API）— 一次 API 调用启动完整 agent
- Google AI Studio — 浏览器内原型构建
- Antigravity 2.0 — Agent-first 开发平台

---

## 产品概念

### 核心体验循环

```
选择故事主题
    ↓
Gemini 生成互动绘本（4~6 页，每页定义一个手势交互）
    ↓
┌─────────────────────────────────────────────┐
│  每一页的循环：                                │
│                                              │
│  1. 展示故事文本 + Imagen 生成的场景插图         │
│  2. 教用户做对应的手影（如：蝴蝶）              │
│  3. 用户做出手影 → 摄像头识别                   │
│  4. 手影变成真实影子投射在"墙壁"上               │
│  5. 用户移动手 → 影子角色从 A 飞到 B            │
│  6. 到达目标 → 翻到下一页                       │
└─────────────────────────────────────────────┘
    ↓
故事结束 → 可保存/分享绘本
```

### 关键交互类型（每页可不同）
| 类型 | 说明 | 实现 |
|------|------|------|
| **学手势** | "做一个兔子手影" → AI 验证 | Gemini 判断 MediaPipe landmarks |
| **移动** | "蝴蝶从花飞到树" → 手从 A 移到 B | 追踪手的 x/y 坐标 |
| **停留** | "小鸟在窝里休息" → 手停在某区域 3 秒 | 坐标 + 计时器 |
| **挥动** | "蝴蝶扇翅膀" → 手指开合 | 检测 landmark 距离变化 |

### 为什么这个方向有机会
- **互动方式有辨识度**: 用户不是只看 AI 生成内容，而是用手影参与故事。
- **Demo 直观**: 摄像头、手影、绘本翻页都能在现场快速展示。
- **AI 能力自然嵌入**: Gemini 负责故事和交互定义，Imagen 负责绘本场景，不是只做一层包装。

---

## 技术架构

### 总览

```
┌──────────── 前端（Next.js）──────────────┐
│                                          │
│  摄像头 → MediaPipe Hands → 21 landmarks │
│      │                                   │
│      ├→ 手影渲染（Canvas 2D）             │
│      │   用 landmarks 画手部轮廓剪影       │
│      │   投射在"墙壁"背景上               │
│      │                                   │
│      ├→ 手势识别（landmarks → Gemini）    │
│      │   截图 + landmarks 发给 Gemini     │
│      │   "这像什么动物？"                  │
│      │                                   │
│      └→ 位置追踪                          │
│          手的中心坐标 → 判断是否到达目标    │
│                                          │
│  故事绘本 UI                              │
│      翻页动画 / 插图展示 / 文字展示        │
│                                          │
└──────────────────────────────────────────┘
          │                    │
          ▼                    ▼
┌─── Gemini 3.5 Flash ───┐  ┌── Imagen 3 ──┐
│                         │  │              │
│ • 生成故事 + 交互指令    │  │ • 场景插图    │
│ • 验证手势是否正确       │  │ • 角色立绘    │
│ • 手势教学提示           │  │ • 皮影风格    │
│                         │  │              │
└─────────────────────────┘  └──────────────┘
          │
          ▼
┌── Cloud Run 部署 ──┐
│ Docker + Next.js   │
└────────────────────┘
```

### 技术栈

| 层级 | 技术 | 用途 |
|------|------|------|
| 框架 | **Next.js 14 (App Router)** | 前端 + API Routes |
| 手部识别 | **MediaPipe Hands** | 浏览器端 21 关节点检测 |
| 影子渲染 | **Canvas 2D** | 从 landmarks 画手部轮廓剪影 |
| 故事生成 | **Gemini 3.5 Flash** | 生成故事 + 交互定义 + 手势验证 |
| 插图生成 | **Imagen 3** | 场景插图（皮影/绘本风格） |
| SDK | **@google/genai** | 统一调用 Gemini + Imagen |
| 部署 | **Google Cloud Run** | 容器化部署 |

---

## 手影渲染：如何从 MediaPipe 画出真实影子

### 核心思路

MediaPipe Hands 给你 21 个关节点。用这些点构建手的**凸包轮廓（Convex Hull）**，填充为纯黑色，就是手影剪影。

```javascript
// MediaPipe 给的 21 个 landmarks
// 0=手腕, 1-4=拇指, 5-8=食指, 9-12=中指, 13-16=无名指, 17-20=小指

function drawShadow(ctx, landmarks, canvasW, canvasH) {
  // 1. 将 landmarks 转为像素坐标
  const points = landmarks.map(lm => ({
    x: lm.x * canvasW,
    y: lm.y * canvasH
  }));

  // 2. 计算凸包（Graham scan 或使用库）
  const hull = convexHull(points);

  // 3. 画影子（纯黑填充 + 模糊边缘）
  ctx.save();
  ctx.filter = 'blur(3px)';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.beginPath();
  ctx.moveTo(hull[0].x, hull[0].y);
  for (let i = 1; i < hull.length; i++) {
    ctx.lineTo(hull[i].x, hull[i].y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
```

### 凸包不够 → 手指细节

凸包会把手指间的凹陷填平，看起来像个手套。需要更精细的轮廓：

```javascript
// 更好的方案：沿着手指逐根画轮廓
function drawDetailedShadow(ctx, landmarks, w, h) {
  const pts = landmarks.map(lm => [lm.x * w, lm.y * h]);

  // 手指轮廓路径（按顺序连接外侧点）
  // 从手腕开始，沿拇指外侧上去，到指尖，
  // 跳到食指外侧，上去到指尖，
  // ... 每根手指都走外侧上、指尖、内侧下
  // 最终回到手腕

  // 外侧路径顺序：
  // 手腕(0) → 拇指(1,2,3,4) →
  // 食指(5,6,7,8) → 中指(9,10,11,12) →
  // 无名指(13,14,15,16) → 小指(17,18,19,20)
  // → 回到手腕(0)

  const fingerChains = [
    [0, 1, 2, 3, 4],       // 拇指
    [0, 5, 6, 7, 8],       // 食指
    [0, 9, 10, 11, 12],    // 中指
    [0, 13, 14, 15, 16],   // 无名指
    [0, 17, 18, 19, 20],   // 小指
  ];

  // 构建手的外轮廓（简化版：连接所有指尖和指根）
  const outline = [
    pts[0],   // 手腕
    pts[1], pts[2], pts[3], pts[4],    // 拇指 → 指尖
    pts[3], pts[2],                     // 回到拇指根部
    pts[5], pts[6], pts[7], pts[8],    // 食指 → 指尖
    pts[7], pts[6],                     // 回到食指根部
    pts[9], pts[10], pts[11], pts[12], // 中指 → 指尖
    pts[11], pts[10],
    pts[13], pts[14], pts[15], pts[16], // 无名指
    pts[15], pts[14],
    pts[17], pts[18], pts[19], pts[20], // 小指
    pts[19], pts[18], pts[17],
    pts[0],   // 回到手腕
  ];

  ctx.save();
  ctx.filter = 'blur(2px)';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.beginPath();
  ctx.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) {
    ctx.lineTo(outline[i][0], outline[i][1]);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
```

### 更高级的方案：加粗手指

每个关节点之间画一个有宽度的"骨骼胶囊"（两个圆 + 矩形），让影子看起来更像真实手的投影：

```javascript
function drawBoneShadow(ctx, landmarks, w, h) {
  const pts = landmarks.map(lm => [lm.x * w, lm.y * h]);

  // 每段骨骼的宽度（像素）
  const boneWidths = {
    palm: 28,
    thumb: 14,
    index: 12,
    middle: 12,
    ring: 11,
    pinky: 10,
  };

  // 骨骼连接定义
  const bones = [
    // 手掌
    { from: 0, to: 5, width: boneWidths.palm },
    { from: 0, to: 9, width: boneWidths.palm },
    { from: 0, to: 13, width: boneWidths.palm },
    { from: 0, to: 17, width: boneWidths.palm },
    { from: 5, to: 9, width: boneWidths.palm * 0.8 },
    { from: 9, to: 13, width: boneWidths.palm * 0.8 },
    { from: 13, to: 17, width: boneWidths.palm * 0.8 },
    // 拇指
    { from: 0, to: 1, width: boneWidths.thumb },
    { from: 1, to: 2, width: boneWidths.thumb },
    { from: 2, to: 3, width: boneWidths.thumb * 0.9 },
    { from: 3, to: 4, width: boneWidths.thumb * 0.8 },
    // 食指
    { from: 5, to: 6, width: boneWidths.index },
    { from: 6, to: 7, width: boneWidths.index * 0.9 },
    { from: 7, to: 8, width: boneWidths.index * 0.8 },
    // 中指
    { from: 9, to: 10, width: boneWidths.middle },
    { from: 10, to: 11, width: boneWidths.middle * 0.9 },
    { from: 11, to: 12, width: boneWidths.middle * 0.8 },
    // 无名指
    { from: 13, to: 14, width: boneWidths.ring },
    { from: 14, to: 15, width: boneWidths.ring * 0.9 },
    { from: 15, to: 16, width: boneWidths.ring * 0.8 },
    // 小指
    { from: 17, to: 18, width: boneWidths.pinky },
    { from: 18, to: 19, width: boneWidths.pinky * 0.9 },
    { from: 19, to: 20, width: boneWidths.pinky * 0.8 },
  ];

  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // 为了合成一个完整剪影，先画到离屏 canvas 再模糊
  for (const bone of bones) {
    const [x1, y1] = pts[bone.from];
    const [x2, y2] = pts[bone.to];
    ctx.lineWidth = bone.width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  // 关节处画圆补齐
  for (let i = 0; i < pts.length; i++) {
    const radius = i <= 4 ? 8 : i % 4 === 0 ? 10 : 6;
    ctx.beginPath();
    ctx.arc(pts[i][0], pts[i][1], radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
```

**推荐 POC 先用"骨骼胶囊"方案**，效果最接近真实手影，实现也相对简单。

---

## Gemini API 集成

### 1. 生成故事 + 交互指令

```javascript
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function generateStory(animal, theme = 'adventure') {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `You are a children's storybook author.
Create a short interactive storybook (4 pages) featuring a ${animal}.
Theme: ${theme}

For each page, output JSON:
{
  "pages": [
    {
      "page_number": 1,
      "story_text": "story narration for this page",
      "scene_description": "visual description for Imagen to generate illustration",
      "interaction": {
        "type": "learn_gesture",  // or "move", "hold", "wave"
        "animal": "butterfly",
        "instruction": "Cross your thumbs and spread your fingers like wings",
        "target_from": null,      // for "move" type: {x: 0.2, y: 0.5}
        "target_to": null,        // for "move" type: {x: 0.8, y: 0.3}
        "hold_seconds": null      // for "hold" type: 3
      }
    }
  ]
}

Rules:
- Page 1 always teaches the main gesture (type: "learn_gesture")
- Pages 2-3 have movement or interaction (type: "move" or "wave")
- Page 4 is the finale
- Keep story text under 30 words per page (it's for kids)
- Scene descriptions should work as Imagen prompts
- Art style: Chinese shadow puppet (皮影戏) aesthetic`
  });

  return JSON.parse(response.text);
}
```

### 2. 验证手势

```javascript
async function verifyGesture(landmarksData, expectedAnimal) {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      {
        text: `Given these hand landmarks from MediaPipe, does this hand gesture look like a "${expectedAnimal}" shadow puppet?

Landmarks (21 points, x/y/z normalized 0-1):
${JSON.stringify(landmarksData)}

Reply with JSON: { "match": true/false, "confidence": 0.0-1.0, "tip": "suggestion to improve" }`
      }
    ]
  });

  return JSON.parse(response.text);
}
```

### 3. 也可以直接用截图让 Gemini 看

```javascript
async function verifyGestureWithImage(imageBase64, expectedAnimal) {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      {
        inlineData: { mimeType: 'image/jpeg', data: imageBase64 }
      },
      {
        text: `Does this hand gesture look like a "${expectedAnimal}" shadow puppet?
Reply JSON: { "match": true/false, "confidence": 0.0-1.0, "tip": "how to improve" }`
      }
    ]
  });

  return JSON.parse(response.text);
}
```

### 4. Imagen 生成场景插图

```javascript
async function generateIllustration(sceneDescription) {
  const response = await ai.models.generateImages({
    model: 'imagen-3.0-generate-002',
    prompt: `Children's storybook illustration, Chinese shadow puppet (皮影戏) art style,
warm colors, paper cutout aesthetic, lantern-lit atmosphere.
Scene: ${sceneDescription}`,
    config: {
      numberOfImages: 1,
      aspectRatio: '16:9',
    }
  });

  // response.generatedImages[0].image.imageBytes → base64
  return response.generatedImages[0].image.imageBytes;
}
```

---

## 项目结构

```
shadowplay-ai/
├── src/
│   ├── app/
│   │   ├── page.tsx                    ← 主页（选主题/开始）
│   │   ├── play/
│   │   │   └── page.tsx                ← 互动绘本页面
│   │   └── api/
│   │       ├── generate-story/
│   │       │   └── route.ts            ← Gemini 生成故事 API
│   │       ├── verify-gesture/
│   │       │   └── route.ts            ← Gemini 验证手势 API
│   │       └── generate-image/
│   │           └── route.ts            ← Imagen 生成插图 API
│   ├── components/
│   │   ├── CameraView.tsx              ← 摄像头 + MediaPipe
│   │   ├── ShadowCanvas.tsx            ← 手影渲染（骨骼胶囊法）
│   │   ├── StoryPage.tsx               ← 单页故事展示
│   │   ├── GestureGuide.tsx            ← 手势教学引导
│   │   ├── InteractionTracker.tsx      ← A→B 移动追踪
│   │   └── StoryBook.tsx              ← 绘本翻页容器
│   ├── lib/
│   │   ├── mediapipe.ts                ← MediaPipe 初始化
│   │   ├── shadow-renderer.ts          ← 手影渲染逻辑
│   │   ├── gesture-classifier.ts       ← 手势分类
│   │   └── gemini.ts                   ← Gemini/Imagen API 封装
│   └── types/
│       └── story.ts                    ← 故事数据类型定义
├── public/
│   └── gestures/                       ← 手势参考图（兔子/蝴蝶/狗等）
├── .env.local                          ← GEMINI_API_KEY
├── Dockerfile
├── cloudbuild.yaml
├── package.json
└── next.config.js
```

---

## 周六时间分配建议（5 小时）

### 赛前准备（周三~周五完成）

| 任务 | 时间 | 详情 |
|------|------|------|
| Next.js 项目脚手架 | 30 min | create-next-app + 安装依赖 |
| MediaPipe + 摄像头 | 1 hr | CameraView.tsx + 基础手部检测 |
| 手影渲染 | 1 hr | ShadowCanvas.tsx（骨骼胶囊法） |
| 绘本 UI 壳子 | 1 hr | StoryBook.tsx + StoryPage.tsx + 翻页 |
| API Routes 骨架 | 30 min | 三个 route.ts 的空壳 |
| Cloud Run 部署配置 | 30 min | Dockerfile + cloudbuild.yaml |
| **合计** | **~4.5 hr** | |

### 周六现场（5 小时）

| 时间段 | 任务 | 产出 |
|--------|------|------|
| 11:30-12:30 | Gemini 故事生成 prompt 调优 | generate-story API 跑通 |
| 12:30-13:30 | 午饭 + Imagen 插图生成调优 | generate-image API 跑通 |
| 13:30-14:30 | 手势验证 + 教学引导 | verify-gesture API + GestureGuide |
| 14:30-15:30 | 串联完整流程：选主题→生成→互动→翻页 | 端到端可跑 |
| 15:30-16:30 | 修 bug + 部署 Cloud Run + 排练 demo | 可演示状态 |

---

## 2 分钟 Demo 脚本

```
[0:00-0:15] "大家好，这是 ShadowPlay AI——一个用手影创造互动绘本的应用。"
            打开应用，选择"冒险"主题。

[0:15-0:30] Gemini 生成故事（展示加载过程）。
            "AI 刚刚为我们写了一个关于蝴蝶的故事。"

[0:30-0:50] 第 1 页：手势教学。
            "它教我做蝴蝶手影——像这样。"
            做蝴蝶手势 → 屏幕上出现蝴蝶剪影 → AI 说 "Great!"

[0:50-1:10] 第 2 页：互动移动。
            "蝴蝶要飞到橡树那边——我来飞过去。"
            手从左移到右 → 影子蝴蝶跟着移动 → 到达目标 → 翻页。

[1:10-1:30] 第 3 页：新角色。
            "现在出现了一只兔子，我来做兔子手影。"
            做兔子手势 → 新影子出现。

[1:30-1:50] 第 4 页：结局 + 生成的绘本。
            展示 Imagen 生成的皮影风格插图。
            "故事结束，我们得到了一本专属绘本。"

[1:50-2:00] "每次生成的故事都不同，手影是真实的。
            技术栈：Gemini 3.5 Flash、Imagen 3、MediaPipe、Cloud Run。
            谢谢！"
```

---

## 关键代码片段

### MediaPipe 加载（浏览器端）

```javascript
// 经典 script 标签方式（比 ES module 更稳定）
// 在 Next.js 中可以用 next/script 组件加载
<Script
  src="https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3/camera_utils.js"
  strategy="beforeInteractive"
/>
<Script
  src="https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/hands.js"
  strategy="beforeInteractive"
/>

// 或者用 npm 包 @mediapipe/hands + @mediapipe/camera_utils
// 但 POC 阶段 script 标签更稳定
```

### 手的中心坐标（用于 A→B 追踪）

```javascript
function getHandCenter(landmarks) {
  // 用手腕(0)和中指根(9)的中点作为"手的中心"
  return {
    x: (landmarks[0].x + landmarks[9].x) / 2,
    y: (landmarks[0].y + landmarks[9].y) / 2
  };
}

function checkReachedTarget(handCenter, target, threshold = 0.08) {
  const dist = Math.hypot(handCenter.x - target.x, handCenter.y - target.y);
  return dist < threshold;
}
```

### Canvas 影子投射效果

```javascript
// "墙壁"效果：影子投射在一个带纹理的暖色背景上
function drawWallBackground(ctx, w, h) {
  // 暖色墙壁
  ctx.fillStyle = '#f5e6d3';
  ctx.fillRect(0, 0, w, h);

  // 可选：微妙的纸质纹理
  ctx.globalAlpha = 0.03;
  for (let i = 0; i < 200; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? '#000' : '#fff';
    ctx.fillRect(
      Math.random() * w,
      Math.random() * h,
      Math.random() * 3,
      Math.random() * 3
    );
  }
  ctx.globalAlpha = 1;
}

// 影子偏移（模拟光源角度）
function drawShadowWithOffset(ctx, landmarks, w, h, offsetX = 20, offsetY = 20) {
  ctx.save();
  ctx.translate(offsetX, offsetY);   // 影子偏移
  ctx.scale(1.1, 1.1);              // 影子略大于手
  drawBoneShadow(ctx, landmarks, w, h);
  ctx.restore();
}
```

---

## 类型定义

```typescript
// types/story.ts

export interface StoryInteraction {
  type: 'learn_gesture' | 'move' | 'hold' | 'wave';
  animal: string;
  instruction: string;
  target_from?: { x: number; y: number };
  target_to?: { x: number; y: number };
  hold_seconds?: number;
}

export interface StoryPage {
  page_number: number;
  story_text: string;
  scene_description: string;
  interaction: StoryInteraction;
  illustration_url?: string;  // Imagen 生成后填入
}

export interface Story {
  title: string;
  theme: string;
  pages: StoryPage[];
}

export type GameState =
  | 'loading'          // 正在生成故事
  | 'teaching'         // 教手势
  | 'waiting_gesture'  // 等待用户做出手势
  | 'gesture_matched'  // 手势匹配成功
  | 'interacting'      // 用户正在做 A→B 移动等交互
  | 'page_complete'    // 当前页完成，准备翻页
  | 'story_complete';  // 故事结束
```

---

## 环境变量

```env
# .env.local
GEMINI_API_KEY=your_gemini_api_key_here
```

---

## 部署

### Dockerfile

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
```

### cloudbuild.yaml

```yaml
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', 'gcr.io/$PROJECT_ID/shadowplay-ai', '.']
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', 'gcr.io/$PROJECT_ID/shadowplay-ai']
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    args:
      - 'gcloud'
      - 'run'
      - 'deploy'
      - 'shadowplay-ai'
      - '--image'
      - 'gcr.io/$PROJECT_ID/shadowplay-ai'
      - '--region'
      - 'asia-northeast1'
      - '--allow-unauthenticated'
      - '--set-env-vars'
      - 'GEMINI_API_KEY=$_GEMINI_API_KEY'
```

---

## MediaPipe / Canvas 实践记录

这些经验对 ShadowPlay 的实时摄像头和画布渲染同样适用：

1. **MediaPipe 加载**: 用 `@mediapipe/hands` script 标签比 `@mediapipe/tasks-vision` ES module 更稳定，后者在部分浏览器/网络下 WASM 加载会失败
2. **Canvas 镜像**: video 和 canvas 都用 CSS `transform: scaleX(-1)` 翻转，landmark 坐标用原始值
3. **Canvas 尺寸**: 用 `video.videoWidth / videoHeight` 而不是 `getBoundingClientRect()`
4. **摄像头权限**: `file://` 协议下不可用，必须通过 `localhost` 或 HTTPS。Next.js `npm run dev` 自带 localhost，不会有这个问题
5. **z 坐标精度有限**: MediaPipe 的 z 是相对深度，不要用它做复杂的 3D 计算

---

## 风险点

| 风险 | 影响 | 缓解方案 |
|------|------|---------|
| Gemini API 延迟 | 故事生成可能要 3-5 秒 | 加 loading 动画；故事可以一次生成全部页 |
| Imagen 生成慢 | 每张图 5-10 秒 | 预生成 + 缓存；demo 时提前触发 |
| 手势识别不准 | Gemini 判断"这不像蝴蝶" | 降低阈值；或用 landmarks 规则而非 Gemini 做实时判断 |
| 手影不像动物 | 剪影太简单看不出形状 | 这是功能，不是 bug——用户的挑战就是把手影做得更像 |
| 光线影响 | 环境光太强/太弱 | Canvas 手影不依赖真实光线，是从 landmarks 计算的 |

---

## 快速启动命令

```bash
# 1. 创建项目
npx create-next-app@14 shadowplay-ai --typescript --tailwind --app --src-dir
cd shadowplay-ai

# 2. 安装依赖
npm install @google/genai

# 3. 创建 .env.local
echo "GEMINI_API_KEY=your_key_here" > .env.local

# 4. 启动开发
npm run dev
# → http://localhost:3000
```
