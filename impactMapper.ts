// ─────────────────────────────────────────────────────────────────────────────
// Impact Mapper
//
// Takes the DiffContext (changed symbols) + DocsIndex
// and produces a list of doc sections that need rewriting.
// ─────────────────────────────────────────────────────────────────────────────

import type { DiffContext, ChangedSymbol } from './types'
import type { DocsIndex, DocSection } from './docsIndex'

export interface ImpactedSection {
  section: DocSection
  triggeredBy: ChangedSymbol[]  // which symbols caused this section to be flagged
}

export interface ImpactMap {
  impactedSections: ImpactedSection[]
  totalSectionsFound: number
  totalSymbolsChecked: number
}

/**
 * Map changed symbols to affected doc sections.
 * A section is impacted if any of its mentioned symbols changed.
 */
export function mapDocsImpact(
  diffContext: DiffContext,
  docsIndex: DocsIndex,
): ImpactMap {
  const { changedSymbols } = diffContext

  // Track which sections are impacted and by which symbols
  // Use file+section as key to deduplicate
  const impactMap = new Map<string, ImpactedSection>()

  for (const symbol of changedSymbols) {
    const affectedSections = docsIndex.symbolToSections[symbol.name] ?? []

    for (const section of affectedSections) {
      const key = `${section.file}::${section.section}`

      if (impactMap.has(key)) {
        // Section already flagged — just add this symbol as a trigger
        impactMap.get(key)!.triggeredBy.push(symbol)
      } else {
        impactMap.set(key, {
          section,
          triggeredBy: [symbol],
        })
      }
    }
  }

  const impactedSections = Array.from(impactMap.values())

  // Log impact summary
  console.log(`[impact] ${changedSymbols.length} symbols checked`)
  console.log(`[impact] ${impactedSections.length} doc sections need updating`)

  for (const impact of impactedSections) {
    const symbols = impact.triggeredBy.map((s) => s.name).join(', ')
    console.log(`[impact] "${impact.section.section}" in ${impact.section.file} — triggered by: ${symbols}`)
  }

  return {
    impactedSections,
    totalSectionsFound: impactedSections.length,
    totalSymbolsChecked: changedSymbols.length,
  }
}