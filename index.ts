// ─────────────────────────────────────────────────────────────────────────────
// Auto-Living Docs — Main Entry Point
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import type { Env } from './types'
import { handleGitHubWebhook } from './webhook'
import { handleLogin, handleCallback, handleLogout } from './auth'

const app = new Hono<{ Bindings: Env }>()

// Health check
app.get('/', (c) =>
  c.json({ service: 'auto-living-docs', version: '0.1.0', status: 'ok' })
)

// GitHub webhook
app.post('/webhooks/github', handleGitHubWebhook)

// GitHub OAuth
app.get('/auth/login',    handleLogin)
app.get('/auth/callback', handleCallback)
app.get('/auth/logout',   handleLogout)

// Dashboard API stub (Week 3)
app.get('/api/me', (c) =>
  c.json({ message: 'Coming in Week 3' }, 501)
)

app.notFound((c) => c.json({ error: 'Not found' }, 404))
app.onError((err, c) => {
  console.error('[app] Unhandled error:', err)
  return c.json({ error: 'Internal server error' }, 500)
})

export default { fetch: app.fetch }