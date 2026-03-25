import type { DiffContext, ChangedSymbol } from './types'
import type { ImpactedSection } from './impactMapper'

export interface RewriteResult {
  file: string
  section: string
  originalContent: string
  rewrittenContent: string
}

function buildChangeSummary(symbols: ChangedSymbol[]): string {
  return symbols.map((s) => {
    if (s.changeType === 'added') {
      return `- NEW function added: \`${s.name}\`\n  Signature: ${s.signatureAfter ?? 'unknown'}`
    }
    if (s.changeType === 'removed') {
      return `- REMOVED function: \`${s.name}\`\n  Was: ${s.signatureBefore ?? 'unknown'}`
    }
    return `- MODIFIED: \`${s.name}\`\n  Before: ${s.signatureBefore ?? 'unknown'}\n  After:  ${s.signatureAfter ?? 'unknown'}`
  }).join('\n')
}

async function rewriteSection(
  section: ImpactedSection,
  diffContext: DiffContext,
  apiKey: string,
): Promise<RewriteResult> {
  const changeSummary = buildChangeSummary(section.triggeredBy)

  const prompt = `You are a technical writer updating documentation to match code changes.

TASK: Rewrite ONLY the documentation section below to reflect the code changes described.

RULES:
- Keep the same markdown heading
- Keep the same general structure and length
- Only update content directly affected by the code changes
- Do not add new sections or remove the heading
- Return ONLY the updated markdown section, nothing else
- No preamble, no explanation, just the updated markdown

CODE CHANGES:
${changeSummary}

CURRENT DOCUMENTATION SECTION (${section.section.section} in ${section.section.file}):
${section.section.section}
${section.section.content}

Updated documentation section:`

  const response = await fetch(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        max_tokens: 1000,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      }),
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Groq API error ${response.status}: ${error}`)
  }

  const data = await response.json() as {
    choices: Array<{
      message: { content: string }
    }>
  }

  const rewrittenContent = data.choices[0]?.message?.content?.trim() ?? ''

  console.log(`[rewrite] Done: "${section.section.section}" in ${section.section.file}`)

  return {
    file: section.section.file,
    section: section.section.section,
    originalContent: section.section.content,
    rewrittenContent,
  }
}

export async function rewriteImpactedSections(
  impactedSections: ImpactedSection[],
  diffContext: DiffContext,
  apiKey: string,
): Promise<RewriteResult[]> {
  if (impactedSections.length === 0) {
    console.log(`[rewrite] No sections to rewrite`)
    return []
  }

  console.log(`[rewrite] Rewriting ${impactedSections.length} section(s)...`)

  const results: RewriteResult[] = []

  for (const section of impactedSections) {
    try {
      const result = await rewriteSection(section, diffContext, apiKey)
      results.push(result)
    } catch (err) {
      console.error(`[rewrite] Failed to rewrite "${section.section.section}":`, err)
    }
  }

  console.log(`[rewrite] Completed ${results.length}/${impactedSections.length} rewrites`)
  return results
}