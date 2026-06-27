# ══════════════════════════════════════════════════════════════════════════
#  Next.js (standalone) → Cloud Run 镜像（SCAFFOLD / 骨架）
#
#  ⚠️ 当前仓库还是静态 ShadowPlay POC（shadow/*.html），尚无 Next.js 应用。
#  这个 Dockerfile 是为后续迁到 Next.js 14 后准备的骨架，
#  在 Next.js 项目（含 package.json / next.config.js）落地到仓库根之前，
#  构建会失败（npm ci 找不到 package.json）。属预期占位状态。
#
#  迁移后需确保：
#   - next.config.js 里设  output: 'standalone'  （否则不会生成 .next/standalone/server.js）
#   - package.json 有  "build": "next build"
# ══════════════════════════════════════════════════════════════════════════

# ── 构建阶段 ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# 先只拷 manifest 装依赖，最大化利用 Docker 层缓存
COPY package*.json ./
RUN npm ci

# 再拷源码并构建
COPY . .
RUN npm run build

# ── 运行阶段（只带 standalone 产物，镜像更小）────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Cloud Run 会通过 $PORT 注入端口（默认 8080）；Next.js standalone 的 server.js 读 PORT
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

# Next.js standalone 输出：server.js + 精简后的 node_modules
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 8080
CMD ["node", "server.js"]
