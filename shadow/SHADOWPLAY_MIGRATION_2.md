# ShadowPlay — 手影渲染 v2：分割方案

## SAM 和 MediaPipe Segmentation 是同一个道理吗？

**是的，核心思路完全一样：** 输入一帧图像 → 输出一张二值 mask（哪些像素是手，哪些是背景）→ 把 mask 当作影子形状。

区别只在于**模型大小和用途**：

| | MediaPipe Selfie Segmentation | SAM / SAM2 / SAM3 |
|---|---|---|
| 原理 | 同一件事：像素级分割 | 同一件事：像素级分割 |
| 模型大小 | ~2MB，专门裁剪过 | 几百MB～几GB |
| 浏览器实时跑 | ✅ 30fps，开箱即用 | ❌ 太重，SAM3 也不行 |
| 准确度 | 够用（人体/手） | 更高，支持任意目标 |
| 使用方式 | `@mediapipe/selfie_segmentation` | 需要服务端或 ONNX 裁剪 |

**结论：** Hackathon 场景用 MediaPipe Selfie Segmentation，和 SAM 是同一个道理，但能在浏览器里 30fps 实时跑。

---

## 为什么要从关键点方案换成分割方案

| 问题 | 关键点方案（v1） | 分割方案（v2） |
|------|----------------|---------------|
| 做什么姿势就是什么影子 | ❌ 靠骨架重建，弯手指形状是猜的 | ✅ 直接用像素，100% 准确 |
| 弯曲/异形手势 | ❌ 骨骼线条填不准 | ✅ 完全跟随 |
| 代码复杂度 | 高（骨架定义、凸包、metaball） | 低（copy mask → shadow） |
| 实现行数 | ~150行渲染逻辑 | ~30行 |

---

## v2 技术栈

```
摄像头帧
  → MediaPipe Selfie Segmentation（浏览器端，~2MB 模型）
  → segmentationMask（每像素 confidence 0-1）
  → canvas：把 mask 画成纯黑
  → 平移 + 模糊 → 投射到"墙壁"背景
```

依然是纯前端，零服务端调用，零额外延迟。

---

## 核心实现（~30行）

```javascript
import { SelfieSegmentation } from '@mediapipe/selfie_segmentation';

const segmentation = new SelfieSegmentation({
  locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${f}`
});

segmentation.setOptions({
  modelSelection: 1,  // 0=通用, 1=景深优化（手部更准）
});

segmentation.onResults(({ segmentationMask, image }) => {
  // segmentationMask 是一张灰度图：白=人，黑=背景

  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // 1. 把 mask 画到离屏 canvas，转成纯黑剪影
  offCtx.clearRect(0, 0, w, h);
  offCtx.drawImage(segmentationMask, 0, 0, w, h);

  // 只保留 mask 区域（destination-in 把非 mask 区域变透明）
  offCtx.globalCompositeOperation = 'source-in';
  offCtx.fillStyle = '#000';
  offCtx.fillRect(0, 0, w, h);
  offCtx.globalCompositeOperation = 'source-over';

  // 2. 把黑色剪影以"影子偏移"投射到主画布
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.filter = 'blur(4px)';                          // 边缘柔化
  ctx.translate(lightOffsetX, lightOffsetY);          // 光源偏移
  ctx.scale(shadowScale, shadowScale);               // 影子放大
  ctx.drawImage(offCanvas, 0, 0);
  ctx.restore();
});
```

---

## 和 v1 的差异对比

```
v1（关键点）：
  摄像头 → 21个关键点 → 手动画骨架 → metaball融合 → 影子

v2（分割）：
  摄像头 → 像素mask → 直接变黑 → 影子
```

v2 没有骨架重建、没有 metaball、没有阈值调参，影子形状就是你真实手的轮廓。

---

## 限制和注意事项

| 限制 | 说明 |
|------|------|
| 分割的是「人体」而不是「手」 | 全身都会被分割出来，需要裁剪区域或结合 Hands landmarks 做 crop |
| 光线影响分割质量 | 背景和手颜色接近时准确度下降 |
| 手势识别要单独做 | Segmentation 只给你形状，不知道是什么手势，手势判断还是走 landmarks 或 Gemini |
| 延迟 | 比 Hands landmarks 稍高，约 +5ms/帧 |

**实践建议：** 同时跑 `SelfieSegmentation`（画影子）+ `Hands`（判断手势），两者并行不互斥。

---

## 如果想要更高精度（赛后迭代）

| 方案 | 精度 | 能否浏览器实时 |
|------|------|--------------|
| MediaPipe Selfie Segmentation | ★★★ | ✅ |
| MediaPipe Image Segmenter (v2) | ★★★★ | ✅ |
| SAM2-tiny (ONNX，裁剪版) | ★★★★★ | ⚠️ 勉强，需 WebGPU |
| SAM3 / 完整 SAM2 | ★★★★★ | ❌ 太重 |

Hackathon 当天用 MediaPipe Selfie Segmentation，完全够用。

---

## 迁移状态

| 步骤 | 状态 |
|------|------|
| v1 骨骼关键点方案 | ✅ 已迁入 Next.js（`components/ShadowStage.tsx`） |
| v2 分割方案 POC | ⏸️ 暂停作为主线：Selfie Segmentation 分的是人体，不是手，实际效果不稳定 |
| 两者并行（分割画影 + landmarks 判手势） | ⏸️ 保留为后续实验方向，当前主线回到 Hands + Canvas 手影框架 |

当前实现采用 hackathon 优先的稳定策略：先保留可靠的实时手影呈现框架，后续再替换成更适合手部分割的模型。
