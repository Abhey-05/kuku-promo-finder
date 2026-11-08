# Deployment

## What is live

- **App:** https://abhey-05.github.io/kuku-promo-finder/ (GitHub Pages, the brief's fallback)
- **Repo:** https://github.com/Abhey-05/kuku-promo-finder

Vercel was not used: its CLI had no login on the build machine. Every push to `main` runs the tests, builds and deploys through `.github/workflows/pages.yml`.

## Checks

- `npm run build` passes with zero TypeScript errors.
- `CHROMIUM_PATH=<chromium> node scripts/smoke.mjs <url> [screenshot-dir] [input-zip]` runs 54 browser checks: heuristic and AI runs (AI through a local mock provider the script starts), Test connection with good and bad keys, CORS probes against each real provider with a fake key, every shortcut, both themes, About Me and phone width.
- The API key is entered in the browser at runtime. The site needs no secrets and no environment variables beyond `NODE_VERSION` on Render.
- Before the first push, `git ls-files` showed no `input_pack/`, `runs/`, `.env*`, `labels.csv` or `docs/private/`. A search of the tree, the git history and `dist/` found no show text. A search for API key patterns found nothing.

## Deploy on Render

`render.yaml` defines a free static site with the same test gate as the Pages workflow. It needs no secrets, because API keys are entered in the browser at runtime.

1. Open https://render.com/deploy?repo=https://github.com/Abhey-05/kuku-promo-finder and sign in with GitHub.
2. Allow Render to read the repo, then click Deploy Blueprint.
3. Open the `onrender.com` URL in a private window to confirm.
4. Put the new URL into `BUILDER.md`, the README and the solution doc.

Pushes to `main` then deploy to both Render and GitHub Pages.

## Switch to Vercel (optional)

Pages works and needs nothing further. To use Vercel instead:

1. Go to vercel.com, sign in with GitHub, click Add New, then Project, and import the repo.
2. Framework preset: Vite. Build command: `npm run build`. Output directory: `dist`. Do not set `VITE_BASE`.
3. Under Settings, Deployment Protection, turn protection off, then open the URL in a private window to confirm.
4. Put the new URL into `BUILDER.md`, the README and the solution doc.
