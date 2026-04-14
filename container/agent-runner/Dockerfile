FROM node:22-slim
WORKDIR /app
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY container/agent-runner/package.json ./container/agent-runner/package.json
RUN corepack enable && pnpm install --frozen-lockfile --prod --filter @aihub/agent-runner... 2>/dev/null || pnpm install --prod --filter @aihub/agent-runner...
COPY packages/shared/dist/ ./packages/shared/dist/
COPY container/agent-runner/dist/ ./container/agent-runner/dist/
# OneCLI CA cert will be bind-mounted at runtime
WORKDIR /app/container/agent-runner
USER node
ENTRYPOINT ["node", "dist/index.js"]
