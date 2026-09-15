# Spectre documentation

Next.js + Fumadocs site, based on the Mise documentation app.

From the repository root:

```bash
pnpm install
pnpm dev:docs # http://localhost:3001
pnpm --filter @spectre/docs lint
pnpm --filter @spectre/docs typecheck
pnpm build:docs
```

Edit `content/docs/**/*.mdx`; navigation is defined in `meta.json` files. The original `docs/GUIDE.md` remains available in the repository; keep shared technical instructions consistent when behavior changes.

## Vercel

- Import the Spectre repository and set Root Directory to `apps/docs`.
- Framework: Next.js. Build command: `pnpm build`. Output directory: default.
- Use the repository's pnpm version and lockfile; enable access to files outside the root directory for workspace installation if prompted.
- Optionally set `NEXT_PUBLIC_SITE_URL` to the production docs origin.
- No Spectre credentials, database, or control server are required.

This deploys the documentation only. The Spectre control server needs long-lived WebSockets and persistent storage and is deployed separately with Docker Compose.

Search, page tables of contents, light/dark themes, social images, sitemap, and Markdown/LLM exports are included. The landing page uses the repository's real control panel screenshot and a labeled illustrative terminal session.
