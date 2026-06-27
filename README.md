# ShadowPlay

**ShadowPlay** is a camera-based hand-shadow web game prototype built for the Gemini AI Hackathon. It turns a player's real hand gestures into a soft black shadow on a warm wall-like stage, creating the foundation for a story-driven interactive game.

The current build focuses on the core stage: webcam input, real-time hand tracking, and expressive shadow rendering. Story scenes, game rules, Gemini-powered interactions, and agent features can now be layered on top of this base.

## Highlights

- Real-time hand tracking with **MediaPipe Hands**
- Canvas-based hand-shadow rendering tuned for a natural silhouette
- Minimal **Next.js** app structure for fast iteration
- Cloud Run-ready Docker setup
- GitHub Actions workflow for Cloud Run deployment
- Public game assets for the rabbit/tortoise story direction

## Tech Stack

| Layer | Choice |
| --- | --- |
| App framework | Next.js |
| Runtime | React + TypeScript |
| Vision tracking | MediaPipe Hands |
| Rendering | Canvas 2D |
| Deployment | Docker + Google Cloud Run |
| CI/CD | GitHub Actions |

## Local Development

Install dependencies:

```bash
npm install
```

Start the dev server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

Then allow camera access and click the camera start button in the app.

## Build Check

```bash
npm run build
```

The production build uses the root `Dockerfile`, which runs Next.js in standalone mode for Cloud Run.

## Cloud Run Deployment

Deployment is configured in:

```text
.github/workflows/deploy-cloudrun.yml
```

The current workflow deploys from `main` and uses a Google Cloud service account JSON key.

Required GitHub Repository Variables:

| Name | Example |
| --- | --- |
| `GCP_PROJECT_ID` | `project-35f45bb4-34ae-49d7-81c` |
| `CLOUD_RUN_SERVICE` | `shadowplay` |
| `CLOUD_RUN_REGION` | `asia-northeast1` |

Required GitHub Repository Secret:

| Name | Description |
| --- | --- |
| `GA_SA_KEY` | Full JSON key for the deploy service account |

The deploy service account should have permissions for Cloud Run deployment, Cloud Build, Artifact Registry, service account usage, and build storage access.

## Project Structure

```text
shadowplay/
├── app/                         # Next.js app routes and global styles
├── components/                  # Core interactive stage
├── public/                      # Game image assets
├── shadow/                      # Migration notes and rendering docs
├── .github/workflows/           # Cloud Run deployment workflow
├── Dockerfile                   # Cloud Run production image
├── package.json
└── README.md
```

## Current Status

ShadowPlay is still a prototype. The hand-shadow stage is ready for gameplay work, while Gemini/agent features and the full game loop are planned as the next layer.

---

# 简体中文

**ShadowPlay** 是一个为 Gemini AI Hackathon 准备的摄像头互动手影 Web 游戏原型。玩家用真实手势在浏览器里生成柔和的黑色手影，投射到暖色墙面舞台上，作为后续剧情互动游戏的基础。

当前版本重点是核心舞台：摄像头采集、实时手部识别、自然手影渲染。后续可以继续加入故事场景、游戏规则、Gemini 互动和 Agent 功能。

## 项目亮点

- 使用 **MediaPipe Hands** 进行实时手部追踪
- 基于 Canvas 2D 的手影渲染，并已调好较自然的默认参数
- 使用 **Next.js** 搭建，方便继续开发游戏内容
- 已准备 Docker + Cloud Run 部署
- GitHub Actions 自动部署 workflow
- 已加入兔子、乌龟、背景等故事方向素材

## 本地运行

```bash
npm install
npm run dev
```

打开：

```text
http://localhost:3000
```

允许摄像头权限后，点击页面里的摄像头启动按钮。

## 构建检查

```bash
npm run build
```

## Cloud Run 部署

部署配置在：

```text
.github/workflows/deploy-cloudrun.yml
```

当前 workflow 从 `main` 分支部署，并使用 `GA_SA_KEY` 这个 GitHub Secret 进行 Google Cloud 认证。

需要配置的 Repository Variables：

- `GCP_PROJECT_ID`
- `CLOUD_RUN_SERVICE`
- `CLOUD_RUN_REGION`

需要配置的 Repository Secret：

- `GA_SA_KEY`：部署用 Service Account 的完整 JSON key

对应的 Service Account 需要具备 Cloud Run、Cloud Build、Artifact Registry、Service Account User 和 Storage 相关权限。
