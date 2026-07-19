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

## Deploying on Back4app Containers + Supabase (no credit card required)

Glitch shut down, so this replaces it as the no-card hosting option. Back4app Containers builds and runs the `Dockerfile` in this repo (added for this purpose) as a normal long-lived process - same `server.js`/`db.js` code as every other deployment path, nothing changes there. This path skips `render.yaml` entirely.

1. **Database - [supabase.com](https://supabase.com):** create a free account (no card), then a new project. Use the **Connect** button (see above) to get the connection string - prefer the **Session pooler** or **Transaction pooler** URI over the direct connection. It looks like `postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres`. Fill in the real database password.
2. **Hosting - [back4app.com](https://back4app.com):** create a free account (no card) → **Containers** → new app → **Deploy from GitHub**, pick this repo. Back4app finds the `Dockerfile` automatically and builds/runs it.
3. In the app's environment/config-variables settings, set:
   ```
   DATABASE_URL=<the Supabase connection string from step 1>
   ADMIN_USER=admin
   ADMIN_PASSWORD=<pick your own>
   ```
   (`PORT` doesn't need to be set - the Dockerfile exposes 3000 and `server.js` already falls back to that when `PORT` isn't provided; Back4app maps its own port to whatever the container exposes.)
4. Once deployed, Back4app gives you a URL for the app (shown on the app's dashboard page).
5. Update `Mario/Client/Managers/KeyAuthManager/KeyAuthClient.h`'s `apiUrl()` to `https://<that-url>/api/1.3/` (see below).

**Free tier caveat:** Back4app's free container tier is 0.25 shared CPU / 256MB RAM / 100GB transfer - plenty for a license server, but it may sleep/cold-start on inactivity similar to Render's free tier. Supabase's free project pauses after a week of no API activity - the first request after that wakes it back up within a minute or so.

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
