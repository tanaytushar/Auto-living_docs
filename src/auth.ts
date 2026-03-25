// ─────────────────────────────────────────────────────────────────────────────
// GitHub OAuth — Dashboard Login
//
// Flow:
//   GET  /auth/login     → redirects to GitHub OAuth, stores state in KV
//   GET  /auth/callback  → exchanges code for token, stores session in KV,
//                          redirects to dashboard
//   GET  /auth/logout    → clears session cookie + KV entry
//
// We use GitHub OAuth App (not GitHub App) for user identity.
// The installation token (from GitHub App) is separate — see github.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { Context } from 'hono'
import { setCookie, getCookie, deleteCookie } from 'hono/cookie'
import type { Env, OAuthState, Session } from './types'

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const GITHUB_USER_URL = 'https://api.github.com/user'

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7   // 7 days
const STATE_TTL_SECONDS   = 60 * 10              // 10 minutes
const COOKIE_NAME = 'ald_session'

function randomHex(bytes = 16): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** GET /auth/login — kick off OAuth */
export async function handleLogin(c: Context<{ Bindings: Env }>) {
  const state = randomHex(16)

  // Store state in KV to verify on callback
  const oauthState: OAuthState = { state, createdAt: Date.now() }
  await c.env.SESSIONS.put(`oauth_state:${state}`, JSON.stringify(oauthState), {
    expirationTtl: STATE_TTL_SECONDS,
  })

  const params = new URLSearchParams({
    client_id: c.env.GITHUB_OAUTH_CLIENT_ID,
    redirect_uri: `${c.env.APP_URL}/auth/callback`,
    scope: 'read:user',
    state,
  })

  return c.redirect(`${GITHUB_AUTHORIZE_URL}?${params}`)
}

/** GET /auth/callback — GitHub redirects here after user approves */
export async function handleCallback(c: Context<{ Bindings: Env }>) {
  const code  = c.req.query('code')
  const state = c.req.query('state')
  const error = c.req.query('error')

  // User denied access
  if (error) {
    return c.redirect(`${c.env.APP_URL}/?error=access_denied`)
  }

  if (!code || !state) {
    return c.json({ error: 'Missing code or state' }, 400)
  }

  // Verify state to prevent CSRF
  const storedStateJson = await c.env.SESSIONS.get(`oauth_state:${state}`)
  if (!storedStateJson) {
    return c.json({ error: 'Invalid or expired state' }, 400)
  }

  // State is single-use — delete it immediately
  await c.env.SESSIONS.delete(`oauth_state:${state}`)

  const storedState: OAuthState = JSON.parse(storedStateJson)
  if (storedState.state !== state) {
    return c.json({ error: 'State mismatch' }, 400)
  }

  // Exchange code for access token
  const tokenRes = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'auto-living-docs/0.1',
    },
    body: JSON.stringify({
      client_id: c.env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: c.env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
      redirect_uri: `${c.env.APP_URL}/auth/callback`,
    }),
  })

  if (!tokenRes.ok) {
    return c.json({ error: 'Failed to exchange code' }, 500)
  }

  const tokenData = await tokenRes.json() as { access_token?: string; error?: string }

  if (tokenData.error || !tokenData.access_token) {
    return c.json({ error: tokenData.error ?? 'No access token returned' }, 400)
  }

  // Fetch user info
  const userRes = await fetch(GITHUB_USER_URL, {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'auto-living-docs/0.1',
    },
  })

  if (!userRes.ok) {
    return c.json({ error: 'Failed to fetch user info' }, 500)
  }

  const user = await userRes.json() as {
    id: number
    login: string
    avatar_url: string
  }

  // Create session
  const sessionId = randomHex(32)
  const session: Session = {
    userId: String(user.id),
    githubLogin: user.login,
    githubToken: tokenData.access_token,
    avatarUrl: user.avatar_url,
    createdAt: Date.now(),
  }

  await c.env.SESSIONS.put(`session:${sessionId}`, JSON.stringify(session), {
    expirationTtl: SESSION_TTL_SECONDS,
  })

  // Set session cookie (HttpOnly, Secure, SameSite=Lax)
  setCookie(c, COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: SESSION_TTL_SECONDS,
    path: '/',
  })

  return c.redirect(`${c.env.APP_URL}/dashboard`)
}

/** GET /auth/logout */
export async function handleLogout(c: Context<{ Bindings: Env }>) {
  const sessionId = getCookie(c, COOKIE_NAME)
  if (sessionId) {
    await c.env.SESSIONS.delete(`session:${sessionId}`)
  }
  deleteCookie(c, COOKIE_NAME, { path: '/' })
  return c.redirect(`${c.env.APP_URL}/`)
}

/**
 * Middleware: require a valid session.
 * Attach the session to context variables for downstream handlers.
 *
 * Usage in routes:
 *   app.get('/dashboard', requireAuth, handleDashboard)
 */
export async function requireAuth(
  c: Context<{ Bindings: Env }>,
  next: () => Promise<void>,
) {
  const sessionId = getCookie(c, COOKIE_NAME)
  if (!sessionId) {
    return c.redirect(`${c.env.APP_URL}/auth/login`)
  }

  const sessionJson = await c.env.SESSIONS.get(`session:${sessionId}`)
  if (!sessionJson) {
    deleteCookie(c, COOKIE_NAME, { path: '/' })
    return c.redirect(`${c.env.APP_URL}/auth/login`)
  }

  const session: Session = JSON.parse(sessionJson)
  c.set('session' as never, session)
  await next()
}
