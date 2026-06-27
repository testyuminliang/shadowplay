# ShadowPlay

## 简体中文

ShadowPlay 是一个为 Gemini AI Hackathon 准备的互动手影 Web 游戏原型。当前版本刻意保持最小可用框架：打开电脑摄像头，通过 MediaPipe Hands 识别手部关键点，并在暖色墙面画布上渲染黑色手影。

### 当前范围

- Next.js 应用骨架
- 浏览器摄像头采集
- MediaPipe Hands 手部识别
- Canvas 手影渲染
- Cloud Run 部署 workflow

故事、Agent、Gemini 集成和实际游戏机制会基于这个核心舞台继续加入。

### 本地开发

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`，点击 `开启摄像头`。

### 部署

Cloud Run 部署配置在 `.github/workflows/deploy-cloudrun.yml`。

部署前需要配置：

- GitHub Repository Variables：`GCP_PROJECT_ID`、`CLOUD_RUN_SERVICE`、`CLOUD_RUN_REGION`
- GitHub Secrets：`WIF_PROVIDER`、`GCP_DEPLOY_SA`

Dockerfile 使用 Next.js standalone 输出，面向 Cloud Run 部署。

## English

ShadowPlay is an interactive hand-shadow web game prototype for the Gemini AI Hackathon. The current app is intentionally minimal: it opens the camera, detects hands with MediaPipe Hands, and renders a black shadow silhouette on a warm wall-like canvas.

## Current Scope

- Next.js app shell
- Browser camera capture
- MediaPipe Hands detection
- Canvas hand-shadow rendering
- Cloud Run deployment workflow scaffold

Story, agent, Gemini, and game mechanics will be added on top of this core stage.

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000` and click `开启摄像头`.

## Deployment

Cloud Run deployment is configured in `.github/workflows/deploy-cloudrun.yml`.

Before deploying, configure:

- GitHub repository variables: `GCP_PROJECT_ID`, `CLOUD_RUN_SERVICE`, `CLOUD_RUN_REGION`
- GitHub secrets: `WIF_PROVIDER`, `GCP_DEPLOY_SA`

The Dockerfile uses Next.js standalone output for Cloud Run.
