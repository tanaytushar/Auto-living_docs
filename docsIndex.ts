// ─────────────────────────────────────────────────────────────────────────────
// Docs Index Builder
//
// Fetches all .md files from the docs folder in the repo,
// parses them to find function/symbol mentions, and builds
// an inverted index: symbol → [{ file, section, content }]
// ─────────────────────────────────────────────────────────────────────────────

import { githubRequest } from './github'

export interface DocSection {
  file: string         // e.g. "docs/cart.md"
  section: string      // e.g. "## Adding items"
  content: string      // full text of that section
}

export interface DocsIndex {
  // symbol name → list of doc sections that mention it
  symbolToSections: Record<string, DocSection[]>
  // all sections found
  allSections: DocSection[]
}

interface GitHubTreeItem {
  path: string
  type: string
  sha: string
  url: string
}

interface GitHubBlob {
  content: string
  encoding: string
}

/** Fetch the full git tree to find all .md files */
async function fetchMarkdownFiles(
  owner: string,
  repo: string,
  sha: string,
  token: string,
): Promise<string[]> {
  const tree = await githubRequest<{ tree: GitHubTreeItem[] }>(
    `/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
    token,
  )

  return tree.tree
    .filter((item) => item.type === 'blob' && item.path.endsWith('.md'))
    .map((item) => item.path)
}

/** Fetch the raw content of a single file */
async function fetchFileContent(
  owner: string,
  repo: string,
  path: string,
  token: string,
): Promise<string> {
  const blob = await githubRequest<{ content: string; encoding: string }>(
    `/repos/${owner}/${repo}/contents/${path}`,
    token,
  )

  if (blob.encoding === 'base64') {
    return atob(blob.content.replace(/\n/g, ''))
  }
  return blob.content
}

/**
 * Parse a markdown file into sections.
 * Each ## or ### heading starts a new section.
 */
function parseSections(filePath: string, content: string): DocSection[] {
  const lines = content.split('\n')
  const sections: DocSection[] = []

  let currentHeading = '## Overview'
  let currentLines: string[] = []

  for (const line of lines) {
    if (line.startsWith('## ') || line.startsWith('### ')) {
      // Save previous section
      if (currentLines.length > 0) {
        sections.push({
          file: filePath,
          section: currentHeading,
          content: currentLines.join('\n').trim(),
        })
      }
      currentHeading = line.trim()
      currentLines = []
    } else {
      currentLines.push(line)
    }
  }

  // Save last section
  if (currentLines.length > 0) {
    sections.push({
      file: filePath,
      section: currentHeading,
      content: currentLines.join('\n').trim(),
    })
  }

  return sections
}

/**
 * Find all symbol names mentioned in a doc section.
 * Looks for: `symbolName` (backtick), symbolName(), or plain word match.
 */
function findSymbolMentions(section: DocSection, symbols: string[]): string[] {
  const mentioned: string[] = []
  const text = section.content + ' ' + section.section

  for (const symbol of symbols) {
    // Match: `symbol`, symbol(), or word boundary match
    const patterns = [
      new RegExp(`\`${symbol}\``),
      new RegExp(`\\b${symbol}\\(`),
      new RegExp(`\\b${symbol}\\b`),
    ]
    if (patterns.some((p) => p.test(text))) {
      mentioned.push(symbol)
    }
  }

  return mentioned
}

/**
 * Build the full docs index for a repo.
 * Pass in the list of symbol names we care about (from the diff).
 */
export async function buildDocsIndex(
  owner: string,
  repo: string,
  sha: string,
  symbolNames: string[],
  token: string,
): Promise<DocsIndex> {
  console.log(`[index] Building docs index for ${owner}/${repo}`)

  // 1. Find all .md files
  const mdFiles = await fetchMarkdownFiles(owner, repo, sha, token)
  console.log(`[index] Found ${mdFiles.length} markdown files`)

  const allSections: DocSection[] = []
  const symbolToSections: Record<string, DocSection[]> = {}

  // Initialize empty arrays for each symbol
  for (const symbol of symbolNames) {
    symbolToSections[symbol] = []
  }

  // 2. For each .md file, fetch content and parse sections
  for (const filePath of mdFiles) {
    try {
      const content = await fetchFileContent(owner, repo, filePath, token)
      const sections = parseSections(filePath, content)
      allSections.push(...sections)

      // 3. Find which symbols are mentioned in each section
      for (const section of sections) {
        const mentions = findSymbolMentions(section, symbolNames)
        for (const symbol of mentions) {
          symbolToSections[symbol].push(section)
        }
      }
    } catch (err) {
      console.warn(`[index] Could not fetch ${filePath}:`, err)
    }
  }

  // Log results
  for (const symbol of symbolNames) {
    const count = symbolToSections[symbol].length
    console.log(`[index] "${symbol}" mentioned in ${count} section(s)`)
  }

  return { symbolToSections, allSections }
}