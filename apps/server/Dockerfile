# Local-development image only. Production deploys go through `wrangler deploy`
# directly to Cloudflare's edge — Workers do not run in this container.
FROM node:22-slim

RUN corepack enable && corepack prepare pnpm@11.18.0 --activate

WORKDIR /workspace

COPY . .
RUN pnpm install --frozen-lockfile || pnpm install

EXPOSE 8787

CMD ["pnpm", "--filter", "server", "dev", "--ip", "0.0.0.0"]
