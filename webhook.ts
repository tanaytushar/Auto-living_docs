import { Context } from 'hono'
import type { Env } from './types'
import { getInstallationToken } from './github'
import { buildDiffContext } from './diff'
import { buildDocsIndex } from './docsIndex'
import { mapDocsImpact } from './impactMapper'
import { rewriteImpactedSections } from './rewriter'
import { openDocsPr } from './prOpener'

async function processPr(
  installationId: number,
  owner: string,
  repo: string,
  prNumber: number,
  headSha: string,
  baseRef: string,
  env: Env,
): Promise<void> {
  console.log(`[pr] Processing ${owner}/${repo}#${prNumber}`)

  // Week 1 — get token + extract changed symbols
  const token = await getInstallationToken(installationId, env)
  const diffContext = await buildDiffContext(owner, repo, prNumber, headSha, token)

  if (diffContext.changedSymbols.length === 0) {
    console.log(`[pr] No symbols changed — skipping`)
    return
  }

  console.log(`[pr] Changed symbols:`)
  for (const s of diffContext.changedSymbols) {
    console.log(`  ${s.changeType.padEnd(8)} ${s.kind.padEnd(10)} ${s.name}  (${s.file})`)
  }

  // Week 2 — build docs index + map impact + rewrite
  const symbolNames = diffContext.changedSymbols.map((s) => s.name)
  const docsIndex = await buildDocsIndex(owner, repo, headSha, symbolNames, token)
  const impactMap = mapDocsImpact(diffContext, docsIndex)

  if (impactMap.impactedSections.length === 0) {
    console.log(`[pr] No docs sections affected — skipping rewrite`)
    return
  }

  const rewrites = await rewriteImpactedSections(
    impactMap.impactedSections,
    diffContext,
    env.ANTHROPIC_API_KEY,
  )

  if (rewrites.length === 0) {
    console.log(`[pr] No rewrites produced — skipping PR`)
    return
  }

  // Week 3 — open a real docs PR
  await openDocsPr(
    owner,
    repo,
    baseRef,
    rewrites,
    diffContext,
    token,
  )

  console.log(`[pr] Done — ${rewrites.length} section(s) rewritten, docs PR opened`)
}

export async function handleGitHubWebhook(c: Context<{ Bindings: Env }>) {
  const rawBody = await c.req.text()
  const event = c.req.header('X-GitHub-Event')

  console.log(`[webhook] Received event: ${event}`)

  if (event !== 'pull_request') {
    return c.json({ ok: true, skipped: `event=${event}` })
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const isMerged = payload.action === 'closed' && payload.pull_request?.merged === true
  console.log(`[webhook] action=${payload.action} merged=${payload.pull_request?.merged}`)

  if (!isMerged) {
    return c.json({ ok: true, skipped: 'not merged' })
  }

  const pr           = payload.pull_request
  const repo         = payload.repository
  const installation = payload.installation

  if (!installation?.id) {
    return c.json({ error: 'Missing installation ID' }, 400)
  }

  try {
    await processPr(
      installation.id,
      repo.owner.login,
      repo.name,
      pr.number,
      pr.head.sha,
      pr.base.ref,
      c.env,
    )
    return c.json({ ok: true, processing: true })
  } catch (err: any) {
    console.error(`[webhook] CRASH:`, err?.message ?? err)
    console.error(`[webhook] Stack:`, err?.stack ?? 'no stack')
    return c.json({ error: String(err) }, 500)
  }
}