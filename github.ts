// ─────────────────────────────────────────────────────────────────────────────
// GitHub App — Installation Token Helper
//
// GitHub Apps authenticate as an installation (not a user) using a short-lived
// token. This module handles generating that token from the App's private key.
//
// Flow:
//   1. Sign a JWT with the App's private key (RS256, expires in 10 minutes)
//   2. POST /app/installations/{id}/access_tokens with that JWT
//   3. Use the returned token for all GitHub API calls for that installation
// ─────────────────────────────────────────────────────────────────────────────

import type { Env } from './types'

const GITHUB_API = 'https://api.github.com'

/**
 * Generate a GitHub App JWT.
 * Valid for up to 10 minutes — used only to fetch the installation token.
 */
async function generateAppJwt(appId: string, privateKeyBase64: string): Promise<string> {
  const privateKeyPem = atob(privateKeyBase64)

  // Import the RSA private key
  const pemBody = privateKeyPem
    .replace(/-----BEGIN RSA PRIVATE KEY-----/, '')
    .replace(/-----END RSA PRIVATE KEY-----/, '')
    .replace(/\s/g, '')

  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0))

  const key = await crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iat: now - 60,       // 60s in the past to allow for clock drift
    exp: now + (10 * 60), // 10 minutes
    iss: appId,
  }

  const encode = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const headerEncoded = encode(header)
  const payloadEncoded = encode(payload)
  const signingInput = `${headerEncoded}.${payloadEncoded}`

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  )

  const signatureEncoded = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

  return `${signingInput}.${signatureEncoded}`
}

/**
 * Get a short-lived installation access token for a GitHub App installation.
 * This token has the permissions defined in your GitHub App settings.
 * It expires after 1 hour — for production, cache it in KV.
 */
export async function getInstallationToken(
  installationId: number,
  env: Env,
): Promise<string> {
  const jwt = await generateAppJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY)

  const res = await fetch(
    `${GITHUB_API}/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'auto-living-docs/0.1',
      },
    },
  )

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Failed to get installation token: ${res.status} ${body}`)
  }

  const data = await res.json() as { token: string }
  return data.token
}

/**
 * Convenience wrapper — makes an authenticated GitHub API request
 * using a pre-fetched installation token.
 */
export async function githubRequest<T>(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'auto-living-docs/0.1',
      ...(options.headers ?? {}),
    },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GitHub API error ${res.status} for ${path}: ${body}`)
  }

  return res.json() as Promise<T>
}
