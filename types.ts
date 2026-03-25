// ─────────────────────────────────────────────────────────────────────────────
// Shared types for Auto-Living Docs
// ─────────────────────────────────────────────────────────────────────────────

/** Cloudflare Worker environment bindings */
export interface Env {
  // KV namespace for sessions
  SESSIONS: KVNamespace

  // Secrets
  GITHUB_APP_ID: string
  GITHUB_APP_PRIVATE_KEY: string       // base64-encoded PEM
  GITHUB_WEBHOOK_SECRET: string
  GITHUB_OAUTH_CLIENT_ID: string
  GITHUB_OAUTH_CLIENT_SECRET: string
  ANTHROPIC_API_KEY: string
  APP_URL: string
}

/** A single changed file extracted from the GitHub PR Files API */
export interface ChangedFile {
  filename: string
  status: 'added' | 'modified' | 'removed' | 'renamed'
  additions: number
  deletions: number
  patch?: string
}

/** A code symbol extracted from a diff */
export interface ChangedSymbol {
  name: string
  kind: 'function' | 'class' | 'type' | 'constant' | 'export'
  changeType: 'added' | 'modified' | 'removed'
  file: string
  signatureBefore?: string
  signatureAfter?: string
}

/** The complete context produced by the diff engine */
export interface DiffContext {
  owner: string
  repo: string
  prNumber: number
  headSha: string
  changedFiles: ChangedFile[]
  changedSymbols: ChangedSymbol[]
  rawPatchByFile: Record<string, string>
}

/** OAuth state stored temporarily in KV during login flow */
export interface OAuthState {
  state: string
  createdAt: number
}

/** Session stored in KV after successful OAuth */
export interface Session {
  userId: string
  githubLogin: string
  githubToken: string
  avatarUrl: string
  createdAt: number
}