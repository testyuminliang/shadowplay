# ShadowPlay

**ShadowPlay** is a camera-based hand-shadow web game built for the Gemini AI Hackathon. It turns a player's real hand gesture into an interactive shadow character and uses that shadow to play through a story inspired by **The Tortoise and the Hare**.

The project combines real-time hand tracking, canvas shadow rendering, lightweight game logic, and Google Cloud Run deployment into a browser-first interactive experience.

## One-Sentence Pitch

ShadowPlay transforms a webcam hand gesture into a playable shadow puppet, letting players control a rabbit-shaped shadow through a story race against the tortoise.

## Why It Matters

Classic hand-shadow play is physical, expressive, and instantly understandable. ShadowPlay brings that interaction into the browser: instead of pressing buttons, the player performs a hand shape, sees it become a shadow, and uses the shadow as the game controller.

## Google I/O Inspiration

ShadowPlay is shaped by the kind of multimodal, agent-ready experiences highlighted around Google I/O: software that understands natural human input, runs as an accessible web experience, and can grow into an AI-assisted creative system. The current prototype proves the realtime interaction layer first, while leaving a clear path for Gemini to become a narrator, coach, or adaptive story engine.

## What Works Today

- Camera-based hand tracking with **MediaPipe Hands**
- Real-time black shadow rendering on a warm wall-like canvas
- Tuned hand-shadow parameters for a natural silhouette
- Rabbit hand-shadow onboarding guide
- Interactive rabbit/tortoise story sequence
- Hand-controlled rabbit movement during race scenes
- Bilingual UI with an English-first interface and Chinese toggle
- Cloud Run-ready Docker deployment
- GitHub Actions workflow for deployment from `main`

## Hackathon Alignment

| Requirement | Current Status |
| --- | --- |
| Google Cloud usage | Deployed with **Google Cloud Run** through GitHub Actions |
| Working demo | Browser app with camera input, hand detection, shadow rendering, and game flow |
| Creativity | Uses the hand itself as a shadow-puppet controller instead of a traditional mouse/keyboard input |
| Completeness | Runs locally with `npm run dev`; builds with `npm run build`; deploys via Docker/Cloud Run |
| AI/Gemini extension | Designed as an agent-ready stage for a Gemini-powered narrator, gesture coach, or adaptive scene generator |

## Demo Flow

1. Open the deployed Cloud Run URL or run the app locally.
2. Allow camera access.
3. Make the rabbit hand-shadow gesture shown in the guide.
4. Move your hand to touch the start button.
5. Control the rabbit shadow through the race scenes.
6. Watch the story resolve into the tortoise-and-hare lesson.

## Tech Stack

| Layer | Choice |
| --- | --- |
| App framework | Next.js |
| Runtime | React + TypeScript |
| Vision tracking | MediaPipe Hands |
| Rendering | Canvas 2D |
| Game interaction | Hand landmark tracking + browser animation loop |
| Deployment | Docker + Google Cloud Run |
| CI/CD | GitHub Actions |

## Architecture

```text
Webcam
  -> MediaPipe Hands
  -> Hand landmarks
  -> Smoothed gesture/shadow model
  -> Canvas hand-shadow renderer
  -> Story/game state machine
  -> Rabbit/tortoise scene animation
```

The app keeps all realtime gesture work in the browser so interaction remains responsive. Cloud Run serves the Next.js app and static assets.

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

Allow camera access when prompted.

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

The workflow deploys from `main` and uses a Google Cloud service account JSON key.

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
├── components/                  # Core interactive stage and game logic
├── public/                      # Rabbit, tortoise, gesture guide, and background assets
├── shadow/                      # Migration notes and rendering docs
├── .github/workflows/           # Cloud Run deployment workflow
├── Dockerfile                   # Cloud Run production image
├── package.json
└── README.md
```

## Next Steps

- Add a Gemini-powered narrator that reacts to player progress.
- Add an in-game hint agent for gesture correction and story guidance.
- Expand the story with generated scene variations.
- Add stronger gesture scoring for more game-like feedback.

---

# 简体中文

**ShadowPlay** 是一个为 Gemini AI Hackathon 制作的摄像头互动手影 Web 游戏。玩家用真实手势生成兔子手影，并用这个手影角色参与《龟兔赛跑》故事互动。

## 项目简介

ShadowPlay 把传统手影游戏搬到浏览器中：玩家不再用键盘鼠标控制角色，而是用手势本身生成影子，并把这个影子作为游戏控制器。

## Google I/O 灵感与价值

ShadowPlay 呼应 Google I/O 所强调的多模态交互、AI agent 和云端部署方向：让软件理解更自然的人类输入，让浏览器体验不只依赖按钮点击，而是直接把身体动作转化为可玩的数字内容。当前版本先证明实时交互和故事舞台，后续可以把 Gemini 接入为旁白、手势教练或自适应剧情引擎。

## 当前已实现

- 使用 **MediaPipe Hands** 进行实时手部追踪
- Canvas 2D 黑色手影渲染
- 已调好的自然手影参数
- 兔子手影教学引导
- 龟兔赛跑故事流程
- 用手控制兔子移动
- 英文优先界面，并支持中文切换
- Docker + Google Cloud Run 部署准备
- GitHub Actions 从 `main` 自动部署

## Hackathon 对齐点

| 要求 | 当前状态 |
| --- | --- |
| Google Cloud 使用 | 通过 **Google Cloud Run** 部署 |
| 可运行完整性 | 摄像头、手势识别、手影渲染、故事流程均可运行 |
| 创新性 | 用真实手影作为游戏角色和控制器 |
| 部署 | 已配置 Cloud Run workflow |
| Gemini/Agent 扩展 | 已为 Gemini 旁白、手势提示 Agent 和自适应故事生成预留清晰方向 |

## 本地运行

```bash
npm install
npm run dev
```

打开：

```text
http://localhost:3000
```

允许摄像头权限后，按照页面提示做出兔子手影并开始游戏。

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
