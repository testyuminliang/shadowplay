# nail.try 💅 — 虚拟美甲试戴 POC

浏览器端实时虚拟美甲试戴：打开摄像头 → MediaPipe Hands 识别手指 → Canvas 在指甲位置实时覆盖美甲，随手部动作运动，识别不到指甲盖的角度则不显示。

> 单文件 POC，`<script>` 标签加载 MediaPipe，无需构建工具。完整迭代记录与迁移计划见 [files/MIGRATION.md](files/MIGRATION.md)。

---

## 🚀 启动（必须用 localhost，不能直接双击打开）

摄像头需要安全上下文（HTTPS 或 localhost）。`file://` 双击打开会被浏览器拒绝授权，所以请起一个本地服务器：

### Mac / Linux
```bash
cd files
./start-server.sh          # 等价于 python3 -m http.server 8080
```

### Windows
```bat
cd files
start-server.bat
```

### 然后在浏览器（推荐 Chrome）打开
```
http://localhost:8080/nail-tryon-poc.html
```
点 **Open Camera** → 允许摄像头 → 把手伸到镜头前。

> 没有 Python 也行，任意静态服务器均可，例如：`npx serve files` 或 `npx http-server files -p 8080`。

---

## 🎛️ 界面控制

| 控件 | 作用 |
|------|------|
| **Choose a style** | 选预设甲色 / 渐变 |
| **AI Generate**（占位） | 上传美甲照片 → Gemini + Imagen 生成甲片（后续接入） |
| **Size** | 甲片整体大小 |
| **Width** | 甲片宽度 |
| **Pos** | 甲片沿手指方向的位置（往甲根 / 往指尖） |
| **Smooth** | 时序平滑强度（One Euro）。右=更稳更抗抖、略有跟手延迟；左=更跟手、抖动更明显；0=关闭 |
| **Debug** | 显示 landmark 骨架与 z 值 |

---

## ✅ 验证（无头浏览器测试套件）

`verify/` 里是用 Puppeteer + headless Chrome 写的验证脚本，POC 的每个修复（滑块、对齐、拇指隐藏、消抖）都用它实测过。

```bash
cd verify
npm install
# 另开一个终端，先在仓库根起服务器：cd files && ./start-server.sh

CHROME_PATH="/path/to/your/Chrome"   # 可选；不设则用脚本里的默认路径
node jitter.js     # 量化消抖效果（开/关 Smooth 的甲片抖动 stddev 对比）
node thumb.js      # 拇指侧棱角度的显示/隐藏
node align.js      # canvas/video object-fit 对齐
node test.js       # 页面加载 + 模型初始化冒烟测试
```

> 脚本默认连 `http://localhost:8080/nail-tryon-poc.html`，所以跑之前要先起服务器。`CHROME_PATH` 用来指向本机的 Chrome / Chrome for Testing 可执行文件。

---

## 🧱 技术栈与路线

- **手部识别**：MediaPipe Hands (Web, `<script>` 加载)
- **渲染**：Canvas 2D（贝塞尔甲形 + 光泽层）
- **消抖**：One Euro 时序滤波
- **计划**：迁移到 Next.js 14 → 接 Gemini 3.5 Flash + Imagen 3 生成甲片 → 部署 Google Cloud Run

完整迭代历史（v1–v9）、已知问题、迁移计划、像素级精度（指甲分割）后续里程碑 ——
全部在 **[files/MIGRATION.md](files/MIGRATION.md)**。

---

## 📂 目录结构

```
nailtest/
├── README.md                  ← 本文件
├── files/
│   ├── nail-tryon-poc.html    ← 核心 POC（自包含，可单独运行）
│   ├── start-server.sh        ← Mac/Linux 本地服务器
│   ├── start-server.bat       ← Windows 本地服务器
│   └── MIGRATION.md           ← 完整迁移文档 / 迭代记录
└── verify/                    ← 无头浏览器验证套件（Puppeteer）
    ├── *.js
    └── package.json
```
