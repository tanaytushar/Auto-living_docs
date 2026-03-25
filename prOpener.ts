// ─────────────────────────────────────────────────────────────────────────────
// PR Opener
//
// Takes the rewrite results from Week 2 and:
//   1. Fetches current file content from GitHub
//   2. Applies the rewritten sections back into the file
//   3. Creates a new branch
//   4. Commits the updated files
//   5. Opens a pull request with a summary
// ─────────────────────────────────────────────────────────────────────────────

import { githubRequest } from './github'
import type { RewriteResult } from './rewriter'
import type { DiffContext } from './types'

interface GitHubFileContent {
  content: string
  encoding: string
  sha: string
}

interface GitHubRef {
  object: { sha: string }
}

interface GitHubCommit {
  sha: string
  tree: { sha: string }
}

interface GitHubTree {
  sha: string
}

interface GitHubNewCommit {
  sha: string
}

interface GitHubPR {
  number: number
  html_url: string
}

/** Fetch current file content + blob SHA (needed for updates) */
async function fetchFile(
  owner: string,
  repo: string,
  path: string,
  token: string,
): Promise<{ content: string; sha: string }> {
  const file = await githubRequest<GitHubFileContent>(
    `/repos/${owner}/${repo}/contents/${path}`,
    token,
  )
  const content = file.encoding === 'base64'
    ? atob(file.content.replace(/\n/g, ''))
    : file.content

  return { content, sha: file.sha }
}

/**
 * Apply a rewritten section back into the full file content.
 * Finds the heading in the file and replaces everything until the next heading.
 */
function applyRewrite(
  fileContent: string,
  sectionHeading: string,
  rewrittenContent: string,
): string {
  const lines = fileContent.split('\n')
  const result: string[] = []

  let inTargetSection = false
  let sectionReplaced = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const isHeading = line.startsWith('## ') || line.startsWith('### ')

    if (line.trim() === sectionHeading.trim()) {
      // Found our target section — inject the rewrite
      inTargetSection = true
      sectionReplaced = true
      result.push(rewrittenContent)
      continue
    }

    if (inTargetSection && isHeading) {
      // Hit the next section — stop replacing
      inTargetSection = false
      result.push(line)
      continue
    }

    if (!inTargetSection) {
      result.push(line)
    }
  }

  if (!sectionReplaced) {
    console.warn(`[pr-opener] Section "${sectionHeading}" not found in file — appending`)
    result.push('\n' + rewrittenContent)
  }

  return result.join('\n')
}

/** Get the SHA of the latest commit on a branch */
async function getBranchSha(
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Promise<string> {
  const ref = await githubRequest<GitHubRef>(
    `/repos/${owner}/${repo}/git/ref/heads/${branch}`,
    token,
  )
  return ref.object.sha
}

/** Create a new branch from a base SHA */
async function createBranch(
  owner: string,
  repo: string,
  branchName: string,
  baseSha: string,
  token: string,
): Promise<void> {
  await githubRequest(
    `/repos/${owner}/${repo}/git/refs`,
    token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: baseSha,
      }),
    },
  )
}

/** Update a file on a branch via the Contents API */
async function updateFile(
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  fileSha: string,
  branch: string,
  token: string,
): Promise<void> {
  const encoded = btoa(unescape(encodeURIComponent(content)))
  await githubRequest(
    `/repos/${owner}/${repo}/contents/${path}`,
    token,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        content: encoded,
        sha: fileSha,
        branch,
      }),
    },
  )
}

/** Open a pull request */
async function createPullRequest(
  owner: string,
  repo: string,
  title: string,
  body: string,
  headBranch: string,
  baseBranch: string,
  token: string,
): Promise<GitHubPR> {
  return githubRequest<GitHubPR>(
    `/repos/${owner}/${repo}/pulls`,
    token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        body,
        head: headBranch,
        base: baseBranch,
      }),
    },
  )
}

/**
 * Main entry point — open a docs PR with all rewritten sections.
 */
export async function openDocsPr(
  owner: string,
  repo: string,
  baseBranch: string,
  rewrites: RewriteResult[],
  diffContext: DiffContext,
  token: string,
): Promise<void> {
  if (rewrites.length === 0) {
    console.log(`[pr-opener] No rewrites to commit`)
    return
  }

  // 1. Create a unique branch name
  const timestamp = Date.now()
  const branchName = `auto-docs/pr-${diffContext.prNumber}-${timestamp}`

  console.log(`[pr-opener] Creating branch: ${branchName}`)

  // 2. Get base branch SHA
  const baseSha = await getBranchSha(owner, repo, baseBranch, token)

  // 3. Create the new branch
  await createBranch(owner, repo, branchName, baseSha, token)

  // 4. Group rewrites by file
  const rewritesByFile = new Map<string, RewriteResult[]>()
  for (const rewrite of rewrites) {
    if (!rewritesByFile.has(rewrite.file)) {
      rewritesByFile.set(rewrite.file, [])
    }
    rewritesByFile.get(rewrite.file)!.push(rewrite)
  }

  // 5. For each file, fetch → apply rewrites → commit
  const updatedFiles: string[] = []

  for (const [filePath, fileRewrites] of rewritesByFile) {
    try {
      console.log(`[pr-opener] Updating ${filePath}...`)

      // Fetch current content
      const { content: currentContent, sha: fileSha } = await fetchFile(
        owner, repo, filePath, token
      )

      // Apply all rewrites for this file
      let updatedContent = currentContent
      for (const rewrite of fileRewrites) {
        updatedContent = applyRewrite(updatedContent, rewrite.section, rewrite.rewrittenContent)
      }

      // Commit the updated file
      const commitMessage = `docs: update ${filePath} for PR #${diffContext.prNumber}`
      await updateFile(
        owner, repo, filePath,
        updatedContent,
        commitMessage,
        fileSha,
        branchName,
        token,
      )

      updatedFiles.push(filePath)
      console.log(`[pr-opener] Committed ${filePath}`)

    } catch (err) {
      console.error(`[pr-opener] Failed to update ${filePath}:`, err)
    }
  }

  if (updatedFiles.length === 0) {
    console.log(`[pr-opener] No files committed — skipping PR`)
    return
  }

  // 6. Build PR description
  const changedSymbols = diffContext.changedSymbols
    .map((s) => `- \`${s.name}\` (${s.changeType})`)
    .join('\n')

  const updatedSections = rewrites
    .map((r) => `- **${r.section}** in \`${r.file}\``)
    .join('\n')

  const prBody = `## Auto-generated docs update

This PR was automatically created by **Auto-Living Docs** in response to code changes in PR #${diffContext.prNumber}.

### Code changes detected
${changedSymbols}

### Documentation sections updated
${updatedSections}

---
*Please review the changes and merge if they look correct.*
*Generated by [Auto-Living Docs](https://github.com/apps/auto-living-docs-dev)*`

  // 7. Open the PR
  const pr = await createPullRequest(
    owner,
    repo,
    `docs: auto-update for PR #${diffContext.prNumber}`,
    prBody,
    branchName,
    baseBranch,
    token,
  )

  console.log(`[pr-opener] PR opened: ${pr.html_url}`)
}