// ─────────────────────────────────────────────────────────────────────────────
// Queue Consumer — PR Job Processor
//
// Cloudflare Queues calls this handler with batches of PrJobMessages.
// For each job:
//   1. Get a GitHub App installation token
//   2. Build the DiffContext (extract changed symbols from the PR)
//   3. Log the result (Week 2 will add: docs impact mapping + LLM rewrite)
//
// The queue provides automatic retries on failure with exponential backoff.
// ─────────────────────────────────────────────────────────────────────────────

import type { Env, PrJobMessage } from './types'
import { getInstallationToken } from './github'
import { buildDiffContext } from './diff'

/**
 * Process a single PR job.
 * Throws on error — the queue will retry automatically.
 */
async function processPrJob(message: PrJobMessage, env: Env): Promise<void> {
  const { installationId, owner, repo, prNumber, headSha } = message

  console.log(`[queue] Processing ${owner}/${repo}#${prNumber}`)

  // 1. Get installation token (short-lived, expires in 1 hour)
  //    TODO (Week 2): cache this in KV to avoid hammering GitHub's token endpoint
  const token = await getInstallationToken(installationId, env)

  // 2. Build the diff context
  const diffContext = await buildDiffContext(owner, repo, prNumber, headSha, token)

  if (diffContext.changedSymbols.length === 0) {
    console.log(`[queue] ${owner}/${repo}#${prNumber}: no symbols changed — skipping`)
    return
  }

  // Log summary for now
  console.log(`[queue] ${owner}/${repo}#${prNumber} diff summary:`)
  for (const symbol of diffContext.changedSymbols) {
    console.log(`  ${symbol.changeType.padEnd(8)} ${symbol.kind.padEnd(10)} ${symbol.name}  (${symbol.file})`)
  }

  // ── Week 2 will add: ──────────────────────────────────────────────────────
  // const impactMap = await mapDocsImpact(diffContext, repoConfig, token)
  // const rewrites  = await rewriteSections(impactMap, diffContext, styleProfile)
  // await openDocsPr(owner, repo, rewrites, token)
}

/**
 * Cloudflare Queue batch handler.
 * Export this as `queue` from your main index.ts.
 */
export async function handleQueue(
  batch: MessageBatch<PrJobMessage>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processPrJob(message.body, env)
      message.ack()
    } catch (err) {
      console.error(
        `[queue] Failed to process ${message.body.owner}/${message.body.repo}#${message.body.prNumber}:`,
        err,
      )
      // Retry — Cloudflare will re-deliver with exponential backoff
      message.retry()
    }
  }
}
