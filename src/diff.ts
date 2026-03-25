import type { ChangedFile, ChangedSymbol, DiffContext } from './types'
import { githubRequest } from './github'

const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs',
  'py', 'go', 'rs', 'java', 'rb',
  'cs', 'cpp', 'c', 'h', 'swift', 'kt', 'php',
])

const MAX_FILES_PER_PAGE = 100

interface GitHubPrFile {
  filename: string
  status: 'added' | 'modified' | 'removed' | 'renamed'
  additions: number
  deletions: number
  patch?: string
  previous_filename?: string
}

function getExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? ''
}

function isCodeFile(filename: string): boolean {
  return CODE_EXTENSIONS.has(getExtension(filename))
}

interface SymbolPattern {
  kind: ChangedSymbol['kind']
  regex: RegExp
  nameGroup: number
}

const SYMBOL_PATTERNS: SymbolPattern[] = [
  { kind: 'function', regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*[(<]/, nameGroup: 1 },
  { kind: 'function', regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/, nameGroup: 1 },
  { kind: 'function', regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function/, nameGroup: 1 },
  { kind: 'class',    regex: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/, nameGroup: 1 },
  { kind: 'type',     regex: /^(?:export\s+)?(?:type|interface)\s+(\w+)[\s<{=]/, nameGroup: 1 },
  { kind: 'constant', regex: /^export\s+(?:const|let|var)\s+(\w+)\s*[:=]/, nameGroup: 1 },
  { kind: 'export',   regex: /^export\s+\{\s*([^}]+)\s*\}/, nameGroup: 1 },
  { kind: 'function', regex: /^def\s+(\w+)\s*\(/, nameGroup: 1 },
  { kind: 'class',    regex: /^class\s+(\w+)[\s:(]/, nameGroup: 1 },
  { kind: 'function', regex: /^func\s+(?:\(.*?\)\s+)?(\w+)\s*\(/, nameGroup: 1 },
  { kind: 'type',     regex: /^type\s+(\w+)\s+(?:struct|interface)/, nameGroup: 1 },
  { kind: 'function', regex: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*[(<]/, nameGroup: 1 },
  { kind: 'type',     regex: /^(?:pub\s+)?(?:struct|enum|trait)\s+(\w+)/, nameGroup: 1 },
]

function extractSymbolsFromPatch(
  patch: string,
  filename: string,
): ChangedSymbol[] {
  const addedSymbols = new Map<string, string>()
  const removedSymbols = new Map<string, string>()

  for (const rawLine of patch.split('\n')) {
    if (!rawLine || rawLine.startsWith('@@') || rawLine.startsWith('\\')) continue

    const sign = rawLine[0]
    if (sign !== '+' && sign !== '-') continue

    const line = rawLine.slice(1).trim()

    for (const pattern of SYMBOL_PATTERNS) {
      const match = line.match(pattern.regex)
      if (!match) continue

      const name = match[pattern.nameGroup]?.trim()
      if (!name || name.length < 2) continue

      if (sign === '+') addedSymbols.set(name, line)
      else removedSymbols.set(name, line)
      break
    }
  }

  const symbols: ChangedSymbol[] = []

  for (const [name, afterSig] of addedSymbols) {
    if (removedSymbols.has(name)) {
      symbols.push({
        name,
        kind: inferKind(afterSig),
        changeType: 'modified',
        file: filename,
        signatureBefore: removedSymbols.get(name),
        signatureAfter: afterSig,
      })
    } else {
      symbols.push({
        name,
        kind: inferKind(afterSig),
        changeType: 'added',
        file: filename,
        signatureAfter: afterSig,
      })
    }
  }

  for (const [name, beforeSig] of removedSymbols) {
    if (!addedSymbols.has(name)) {
      symbols.push({
        name,
        kind: inferKind(beforeSig),
        changeType: 'removed',
        file: filename,
        signatureBefore: beforeSig,
      })
    }
  }

  return symbols
}

function inferKind(line: string): ChangedSymbol['kind'] {
  if (/\bclass\b/.test(line)) return 'class'
  if (/\b(type|interface)\b/.test(line)) return 'type'
  if (/\b(function|def|fn|func)\b/.test(line)) return 'function'
  if (/^export\s+const/.test(line)) return 'constant'
  return 'export'
}

async function fetchAllChangedFiles(
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
): Promise<GitHubPrFile[]> {
  const files: GitHubPrFile[] = []
  let page = 1

  while (true) {
    const batch = await githubRequest<GitHubPrFile[]>(
      `/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=${MAX_FILES_PER_PAGE}&page=${page}`,
      token,
    )
    files.push(...batch)
    if (batch.length < MAX_FILES_PER_PAGE) break
    page++
    if (page > 10) break
  }

  return files
}

export async function buildDiffContext(
  owner: string,
  repo: string,
  prNumber: number,
  headSha: string,
  token: string,
): Promise<DiffContext> {
  const allFiles = await fetchAllChangedFiles(owner, repo, prNumber, token)
  const codeFiles = allFiles.filter((f) => isCodeFile(f.filename))

  const changedFiles: ChangedFile[] = codeFiles.map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch,
  }))

  const allSymbols: ChangedSymbol[] = []
  const rawPatchByFile: Record<string, string> = {}

  for (const file of codeFiles) {
    if (file.patch) {
      rawPatchByFile[file.filename] = file.patch
      const symbols = extractSymbolsFromPatch(file.patch, file.filename)
      allSymbols.push(...symbols)
    }
  }

  const seen = new Set<string>()
  const uniqueSymbols = allSymbols.filter((s) => {
    const key = `${s.file}::${s.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  console.log(
    `[diff] ${owner}/${repo}#${prNumber}: ` +
    `${changedFiles.length} code files, ${uniqueSymbols.length} changed symbols`
  )

  return {
    owner,
    repo,
    prNumber,
    headSha,
    changedFiles,
    changedSymbols: uniqueSymbols,
    rawPatchByFile,
  }
}
