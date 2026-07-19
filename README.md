# KeyServer

Self-hosted license-key validation backend for the Mario client, replacing keyauth.win. Protocol-compatible with what `KeyAuthClient.h` already sends (`type=init` / `type=license` / `type=logout` form POSTs), so the C++ side only needs its API URL changed - see the bottom of this file.

## How it works

- `type=init` - creates a session row, returns a `sessionid`.
- `type=license` - validates `key` against the `licenses` table (active? not expired? HWID matches, or binds on first use?), and re-attaches the session to that key. A successful login always clears out any *other* session tied to the same key first, so a session that never got a clean logout (a crash instead of a normal eject, say) can never permanently lock out a future login.
- `type=logout` - deletes the session row.

Response shape (`{success, message}`, plus `{sessionid}` for init) matches what `KeyAuthClient::parseResponse()`/`init()` already parse - no client-side parsing changes needed.

## Deploying on Render

1. Push this folder to a GitHub repo (Render deploys from a repo, not a local folder).
2. In the Render dashboard: **New → Blueprint**, point it at the repo. `render.yaml` provisions both the web service and a free Postgres database, and wires `DATABASE_URL` between them automatically.
3. Wait for the first deploy to finish, then copy the web service's URL (`https://<something>.onrender.com`).
4. Update `Mario/Client/Managers/KeyAuthManager/KeyAuthClient.h`'s `apiUrl()` to `https://<something>.onrender.com/api/1.3/` (see below).

**Free tier caveat:** Render's free web services spin down after ~15 minutes of inactivity and take ~30-60s to wake back up on the next request - the first license check after a while idle will be slow. Upgrade to a paid instance (or ping it periodically to keep it warm) if that matters to you. Free Postgres instances on Render also get deleted after 90 days unless upgraded - export/back up your `licenses` table before then, or upgrade the database plan.

## Deploying on Vercel + Supabase (no credit card, stable URL - recommended if you can't use Render)

Vercel's free Hobby plan needs no credit card and, unlike the containers-based options below, its project URL (`https://<project>.vercel.app`) is permanent from the first deploy - no "temporary URL" paywall to work around. The tradeoff: Vercel runs code as serverless functions, not a normal long-lived process, so this repo is structured to support both - `app.js` holds the actual Express app, `server.js` is the traditional entry point (`app.listen()`, used by Render/Docker/local dev), and `api/index.js` + `vercel.json` are the Vercel-specific entry point that route every request to the same `app.js` without ever calling `.listen()`. You don't need to touch any of that - just deploy.

1. **Database - [supabase.com](https://supabase.com):** create a free account (no card), then a new project. Use the **Connect** button to get the connection string - prefer the **Session pooler** or **Transaction pooler** URI over the direct connection. It looks like `postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres`. Fill in the real database password.
2. **Hosting - [vercel.com](https://vercel.com):** sign up with GitHub (no card) → **Add New → Project** → import this repo. Vercel auto-detects it as a Node project; you don't need to change the build/output settings it suggests.
3. Before the first deploy (or after, then redeploy), add these under the project's **Settings → Environment Variables**:
   ```
   DATABASE_URL=<the Supabase connection string from step 1>
   ADMIN_USER=admin
   ADMIN_PASSWORD=<pick your own>
   ```
4. Deploy. Your permanent URL is shown on the project dashboard, e.g. `https://keyserver-yourname.vercel.app`.
5. Update `Mario/Client/Managers/KeyAuthManager/KeyAuthClient.h`'s `apiUrl()` to `https://keyserver-yourname.vercel.app/api/1.3/` (see below).

**Caveats:** each serverless invocation has a cold start (usually well under a second, longer after long idle periods) - noticeable but much less than Render/Back4app's free-tier sleep delay. Vercel's Hobby plan ToS restricts it to personal/non-commercial use - if this ever becomes a paid product, that's worth revisiting. Supabase's free project pauses after a week of no API activity - the first request after that wakes it back up within a minute or so.

## Deploying on Back4app Containers + Supabase (no credit card, but read the URL caveat first)

Back4app Containers builds and runs the `Dockerfile` in this repo as a normal long-lived process (same `server.js`/`db.js` code as Render). This path skips `render.yaml` entirely.

**Important:** on the free plan, the app's URL is *temporary* - Back4app's dashboard literally says "URL is temporary and will be live for 60 minutes," and getting a permanent URL requires upgrading to a paid plan starting at $5/month. That makes the free tier unusable for this project's purpose (the client's `apiUrl()` is a fixed string baked into the compiled DLL, so a URL that changes every hour breaks license checks) - **use the Vercel option above instead unless you're paying for Back4app's Shared plan.**

1. **Database - [supabase.com](https://supabase.com):** same as the Vercel steps above.
2. **Hosting - [back4app.com](https://back4app.com):** create a free account (no card) → **Containers** → new app → **Deploy from GitHub**, pick this repo. Back4app finds the `Dockerfile` automatically and builds/runs it.
3. In the app's **Settings → Environment Variables**, set:
   ```
   DATABASE_URL=<the Supabase connection string from step 1>
   ADMIN_USER=admin
   ADMIN_PASSWORD=<pick your own>
   ```
   (`PORT` doesn't need to be set - the Dockerfile exposes 3000 and `server.js` already falls back to that when `PORT` isn't provided.)
4. Save, then trigger a deployment if one doesn't start automatically.
5. If you upgrade for a permanent URL, update `Mario/Client/Managers/KeyAuthManager/KeyAuthClient.h`'s `apiUrl()` to `https://<that-url>/api/1.3/` (see below).

## Admin dashboard

A password-protected web page at `/admin` (e.g. `https://<something>.onrender.com/admin`) lists all keys and lets you add/disable/enable/unbind/delete them from a browser, so you don't need CLI access to the database every time.

It's gated by HTTP Basic Auth against the `ADMIN_USER`/`ADMIN_PASSWORD` env vars. `render.yaml` sets `ADMIN_USER=admin` and auto-generates a random `ADMIN_PASSWORD` on deploy - find the generated password in the Render dashboard under the `keyserver` service's **Environment** tab. Change either value there any time; the running service picks up env var changes on its next deploy/restart. If `ADMIN_PASSWORD` isn't set, `/admin` returns a 500 instead of allowing access.

## Managing keys

From your own machine, with a `.env` file (copy `.env.example`) pointing `DATABASE_URL` at the **same** database the deployed service uses (Render's dashboard gives you an external connection string for this - the internal one only works from inside Render's network; on Supabase, the connection string from Settings → Database works from anywhere already):

```
npm install
npm run keys -- add                  # random key, no expiry
npm run keys -- add MY-CUSTOM-KEY 30 # specific key, expires in 30 days
npm run keys -- list
npm run keys -- disable <key>
npm run keys -- enable <key>
npm run keys -- unbind <key>         # clear HWID binding, e.g. after a hardware change
```

## Local development

```
npm install
cp .env.example .env   # point DATABASE_URL at a local or Render Postgres instance
npm start
```
