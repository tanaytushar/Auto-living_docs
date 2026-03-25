# Week 1 Setup Guide — Auto-Living Docs

## What you're setting up

By the end of this guide you'll have:
- A live Cloudflare Worker receiving GitHub webhooks
- A GitHub App installed on a test repo
- Real PR events flowing through → queued → diff extracted → logged
- GitHub OAuth login working

---

## Step 1 — Install tools (10 min)

```bash
# Install Node.js 22 if you don't have it
# https://nodejs.org/

# Install dependencies
cd auto-living-docs
npm install

# Login to Cloudflare
npx wrangler login
```

---

## Step 2 — Create the Cloudflare Queue + KV (5 min)

```bash
# Create the queue
npx wrangler queues create pr-jobs

# Create the KV namespace
npx wrangler kv namespace create SESSIONS

# Copy the KV namespace ID printed above into wrangler.toml:
# [[kv_namespaces]]
# id = "PASTE_ID_HERE"
```

---

## Step 3 — Create your GitHub App (15 min)

1. Go to: **github.com/settings/apps → New GitHub App**

2. Fill in:
   - **GitHub App name**: `Auto Living Docs Dev` (or any name)
   - **Homepage URL**: `http://localhost:8787` (change to prod URL later)
   - **Webhook URL**: We'll come back to this — use a smee.io proxy for local dev (see Step 5)
   - **Webhook secret**: Run `openssl rand -hex 32` and paste here AND save it

3. **Permissions** (Repository permissions):
   - Contents: **Read** (to read code + docs files)
   - Pull requests: **Write** (to open docs PRs)
   - Metadata: **Read** (required)

4. **Subscribe to events**:
   - Check **Pull request**

5. Click **Create GitHub App**

6. On the app page:
   - Note your **App ID** (shown at top)
   - Scroll to **Private keys** → **Generate a private key** → download the `.pem` file
   - Convert to base64: `cat your-key.pem | base64 | tr -d '\n'`

---

## Step 4 — Create your GitHub OAuth App (5 min)

1. Go to: **github.com/settings/developers → OAuth Apps → New OAuth App**

2. Fill in:
   - **Application name**: `Auto Living Docs`
   - **Homepage URL**: `http://localhost:8787`
   - **Authorization callback URL**: `http://localhost:8787/auth/callback`

3. Click **Register application**

4. Note your **Client ID** and generate a **Client secret**

---

## Step 5 — Set up webhook forwarding for local dev (5 min)

Cloudflare Workers run in the cloud, not localhost.
For local dev, use smee.io to forward webhooks:

```bash
# Install smee client
npm install -g smee-client

# Create a channel at smee.io — note the URL it gives you
# e.g. https://smee.io/abc123xyz

# Start forwarding (run this in a separate terminal)
smee --url https://smee.io/abc123xyz --path /webhooks/github --port 8787
```

Go back to your GitHub App settings → set **Webhook URL** to your smee.io URL.

---

## Step 6 — Configure environment variables (5 min)

```bash
# Copy the example file
cp .env.example .dev.vars

# Edit .dev.vars with your real values (this file is gitignored)
# Fill in all the values from Steps 3 and 4
```

For production secrets:
```bash
npx wrangler secret put GITHUB_APP_ID
npx wrangler secret put GITHUB_APP_PRIVATE_KEY
npx wrangler secret put GITHUB_WEBHOOK_SECRET
npx wrangler secret put GITHUB_OAUTH_CLIENT_ID
npx wrangler secret put GITHUB_OAUTH_CLIENT_SECRET
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put APP_URL
```

---

## Step 7 — Run locally + test (10 min)

```bash
# Start the dev server
npm run dev
# → Local: http://localhost:8787

# In another terminal — start smee forwarding
smee --url YOUR_SMEE_URL --path /webhooks/github --port 8787

# Test health check
curl http://localhost:8787/
# → {"service":"auto-living-docs","status":"ok",...}

# Test OAuth login
open http://localhost:8787/auth/login
# → Should redirect to GitHub → approve → redirect back to /dashboard
```

---

## Step 8 — Install the GitHub App on a test repo + fire a real webhook (10 min)

1. Go to your GitHub App settings → **Install App** → Install on a test repo

2. Create a test branch, make a code change (e.g. add a function), open a PR, merge it

3. Watch your Wrangler dev server logs — you should see:
```
[webhook] Enqueued job for yourname/testrepo#1
[queue] Processing yourname/testrepo#1
[diff] yourname/testrepo#1: 1 code files, 1 changed symbols
[queue] yourname/testrepo#1 diff summary:
  added    function   myNewFunction  (src/utils.ts)
```

If you see those logs — **Week 1 is complete.**

---

## Troubleshooting

**Webhook shows 401 Invalid signature**
→ Check GITHUB_WEBHOOK_SECRET in .dev.vars matches exactly what's in GitHub App settings

**Queue consumer not running locally**
→ Queues don't work in `wrangler dev` by default. Add `--local` flag or test by deploying:
```bash
npm run deploy
```

**JWT error when getting installation token**
→ Make sure the private key PEM is base64-encoded with no newlines:
```bash
cat your-key.pem | base64 | tr -d '\n'
```

---

## Week 1 Checklist

- [ ] Cloudflare Worker deployed and health check returns 200
- [ ] GitHub App created with correct permissions
- [ ] GitHub OAuth App created
- [ ] Webhook receives events and returns 200
- [ ] Merging a PR triggers the queue consumer
- [ ] Diff extraction logs changed symbols correctly
- [ ] OAuth login flow completes and sets session cookie
