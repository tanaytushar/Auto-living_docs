# Auto-Living Docs

**Docs that write themselves.**

Merge a PR → your documentation updates automatically. No manual work. No stale docs. Ever.

[![Install on GitHub](https://img.shields.io/badge/Install%20on-GitHub-7c3aed?style=for-the-badge&logo=github)](https://github.com/apps/auto-living-docs-dev)
[![Live Demo](https://img.shields.io/badge/Live-Demo-22c55e?style=for-the-badge)](https://shy-frog-14c6.autolivingdocs.workers.dev)
[![Built on Cloudflare](https://img.shields.io/badge/Built%20on-Cloudflare%20Workers-f38020?style=for-the-badge&logo=cloudflare)](https://workers.cloudflare.com)

---

## The Problem

Every software team has the same problem. Engineers ship code, docs go stale. Nobody updates them. Users get confused. Support tickets pile up.

The reason is simple — updating docs is boring, manual, and easy to forget. So nobody does it.

## The Solution

Auto-Living Docs watches your GitHub repos for merged PRs. When code changes, it:

1. Detects which functions, classes, and types changed
2. Finds exactly which doc sections mention those symbols
3. Rewrites just those sections using AI — in your team's voice
4. Opens a pull request with the updated docs for human review

You just click **Merge**. Your docs stay current forever.

---

## How It Works

```
Engineer merges a code PR
         ↓
Webhook fires instantly
         ↓
Diff engine extracts changed symbols
         ↓
Docs index finds affected sections
         ↓
AI rewrites those sections
         ↓
Bot opens a docs PR automatically ✅
```

### Live terminal output

```
[webhook] PR #42 merged → yourorg/your-api
[diff]    2 code files, 3 changed symbols
[diff]    modified  function  processPayment  (src/payments.ts)
[diff]    added     function  validateCard    (src/payments.ts)
[index]   "processPayment" mentioned in 1 section(s)
[impact]  "## Processing payments" in docs/payments.md
[rewrite] Rewriting 1 section(s)...
[rewrite] Done: "## Processing payments" in docs/payments.md
✓ PR opened: docs: auto-update for PR #42
```

---

## Installation

1. Go to [github.com/apps/auto-living-docs-dev](https://github.com/apps/auto-living-docs-dev)
2. Click **Install**
3. Select the repositories to watch
4. Add a `/docs` folder with `.md` files that mention your function names
5. Merge any PR with a code change — watch the magic happen

**That's it. No config files. No YAML. No setup.**

---

## Requirements

For Auto-Living Docs to rewrite a doc section, two things need to be true:

- Your code repo has files with functions/classes (`.js`, `.ts`, `.py`, `.go`, `.rs`, etc.)
- Your docs folder has `.md` files that mention those function names with backticks

**Example:**

````markdown
## Processing payments

Use the `processPayment` function to charge a customer.
````

When `processPayment` changes in your code, this section gets rewritten automatically.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers (TypeScript) |
| Framework | Hono |
| AI Rewriter | Groq (llama-3.1-8b-instant) |
| Session store | Cloudflare KV |
| Auth | GitHub OAuth App |
| Webhook | GitHub App |

---

## Pricing

| Plan | Price | Repos |
|---|---|---|
| Starter | $19/repo/mo | 1 repo, 50 PRs/mo |
| Pro | $49/repo/mo | Unlimited PRs, custom voice |
| Team | $29/repo/mo | 5+ repos, shared org profile |

---

## Project Structure

```
├── index.ts          # Main Hono app entry point
├── webhook.ts        # GitHub webhook receiver + pipeline orchestrator
├── diff.ts           # Diff extraction engine
├── github.ts         # GitHub App token + API helpers
├── auth.ts           # GitHub OAuth login flow
├── docsIndex.ts      # Docs index builder
├── impactMapper.ts   # Symbol → doc section mapper
├── rewriter.ts       # AI rewriter (Groq API)
├── prOpener.ts       # Branch creator + PR opener
├── types.ts          # Shared TypeScript types
├── wrangler.toml     # Cloudflare Workers config
└── landing/
    └── index.html    # Landing page
```

---

## Local Development

```bash
# Install dependencies
npm install

# Copy env file
cp .env.example .dev.vars
# Fill in your values in .dev.vars

# Start local server
npx wrangler dev --show-interactive-dev-session=false

# In a second terminal — forward webhooks locally
smee --url https://smee.io/YOUR_CHANNEL --path /webhooks/github --port 8787
```

### Required environment variables

```
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=       # base64-encoded PEM
GITHUB_WEBHOOK_SECRET=
GITHUB_OAUTH_CLIENT_ID=
GITHUB_OAUTH_CLIENT_SECRET=
ANTHROPIC_API_KEY=            # or Groq API key
APP_URL=
```

---

## Deployment

```bash
# Deploy to Cloudflare Workers
npx wrangler deploy

# Set production secrets
npx wrangler secret put GITHUB_APP_ID
npx wrangler secret put GITHUB_APP_PRIVATE_KEY
npx wrangler secret put GITHUB_WEBHOOK_SECRET
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put APP_URL
```

---

## Roadmap

- [x] GitHub webhook integration
- [x] Diff extraction engine
- [x] Docs impact mapper
- [x] AI section rewriter
- [x] Automatic PR opener
- [x] Production deployment
- [x] Landing page
- [ ] Stripe billing
- [ ] GitHub Marketplace listing
- [ ] Custom voice profile editor
- [ ] Slack notifications
- [ ] Dashboard UI

---

## Built By

**Tanay Tushar** — built as a side project while working as a Research Analyst.

> "Engineers hate writing docs. I built a bot that does it for them."

---

## License

MIT
