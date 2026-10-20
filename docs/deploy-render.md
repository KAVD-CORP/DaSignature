# Deploying the DaSignature web app on Render

The web app is a fully static site: plain files, no server code, no database, no API keys. Every
signature and document stays in the visitor's browser. Render only serves the files. This guide
covers the two ways to set it up on Render (Dashboard and Blueprint) and how to get the code into a
new GitHub repository first.

## What Render needs (checked 2026-10-20)

- **A Git repository. Manual upload isn't supported.** Render Static Sites build from a connected
  Git repository (GitHub, GitLab or Bitbucket) and redeploy on every push to the chosen branch.
  There is no ZIP or drag-and-drop upload for static sites. Render's own docs only describe the
  "connect your repo" flow (render.com/docs/static-sites, render.com/docs/your-first-deploy), and
  Render support confirmed on the community forum that a static site can't be deployed without Git.
  The SSH/shell feature is for debugging and its filesystem is ephemeral. So step 1 is always
  pushing the code to a repository.
- **Node 20.19.** Render reads `.node-version` at the repo root (it already says `20.19`). Without
  it Render would pick its own default (Node 24 for new services).
- **pnpm.** Render detects pnpm from `pnpm-lock.yaml`. `render.yaml` sets `SKIP_INSTALL_DEPS=true`
  so Render doesn't run an npm install of its own before our `pnpm install --frozen-lockfile`.

## Step 1: Push the code to a new GitHub repository

You need a free GitHub account and Git installed on your computer.

1. On github.com, click **+ → New repository**. Name it, for example `dasignature`. Choose
   Public or Private (both work with Render). Do **not** add a README, license or .gitignore,
   because the code already has them. Click **Create repository**.
2. Open a terminal in the `source` folder from the release zip. It already is a Git repository
   with the full history. Then run:

   ```sh
   git remote add origin https://github.com/<your-user>/dasignature.git
   git branch -M main
   git push -u origin main
   ```

   GitHub asks you to sign in. Use a personal access token or GitHub Desktop if a password
   prompt is refused.

To use GitLab or Bitbucket instead, create an empty project there and push the same way. Render
supports all three.

## Step 2, option A: Blueprint (recommended, everything is preconfigured)

`render.yaml` at the repo root is a Render Blueprint. It defines the static site, the build, the
publish folder, the security headers (Content-Security-Policy, Referrer-Policy, nosniff,
Permissions-Policy), the caching rules and the single-page-app rewrite.

1. Sign in at dashboard.render.com and connect your GitHub account when asked.
2. Click **New → Blueprint**, pick your repository and click **Connect**.
3. Render shows the service `dasignature` (Static Site). Click **Apply**.
4. The first build takes a few minutes. Then open the `https://dasignature-xxxx.onrender.com` URL.

Later changes to `render.yaml` are applied automatically when you push.

## Step 2, option B: Dashboard (manual settings)

1. Click **New → Static Site**, pick the repository and click **Connect**.
2. Fill in:
   - **Branch:** `main`
   - **Root Directory:** leave empty
   - **Build Command:** `pnpm install --frozen-lockfile && pnpm --filter web build`
   - **Publish Directory:** `apps/web/dist`
3. **Environment:** add `SKIP_INSTALL_DEPS` = `true`.
4. Click **Create Static Site**.
5. Open the site's **Redirects/Rewrites** page and add, in this order:
   1. Source `/assets/*`, Destination `/missing-asset.txt`, Action **Rewrite**
   2. Source `/*`, Destination `/index.html`, Action **Rewrite**
6. Open the **Headers** page and add every rule from the `headers:` list in `render.yaml` (path,
   name, value), exactly as written. The CSP value must be copied character for character.

Option B gives the same result as A but is easy to get wrong. If you are unsure, use the Blueprint.

## Check the deployment

- The page loads and shows "DaSignature". In the browser's developer tools, the Network tab shows
  only requests to your own `onrender.com` address.
- The response headers for `/` include `content-security-policy` and `cache-control: no-cache`.
  Files under `/assets/` have `cache-control: public, max-age=31536000, immutable`.
- After one visit the app also works offline (service worker). In Chrome or Edge you can install it
  with the install icon in the address bar.

Locally, `pnpm build && pnpm check:render` runs the same header and rewrite rules against the
build (scripts/qa/check-render-headers.mjs).

## Custom domain (optional)

Under **Settings → Custom Domains**, add your domain and create the DNS record Render shows. HTTPS
certificates are issued automatically.

## Updating

Push to `main`. Render rebuilds and switches over atomically. Visitors get the new version the next
time they open the app (the service worker updates itself; old caches are deleted).
