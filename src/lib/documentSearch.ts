import type { DocumentSearchResult, VaultDocument, WillData } from './types'

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'my', 'me', 'i', 'of', 'to', 'in', 'for', 'on', 'and', 'or',
  'is', 'are', 'do', 'does', 'have', 'has', 'show', 'find', 'which', 'what',
  'all', 'everything', 'related', 'documents', 'document', 'me',
])

export function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
}

function documentSearchText(document: VaultDocument, data: WillData): string {
  const metadataValues = Object.values(document.extractedMetadata).join(' ')

  // Enrich the searchable text with related estate data so queries such as
  // "my Noida property" match a property document even if the file name does
  // not mention the location.
  const related: string[] = []
  if (document.category === 'property') {
    related.push(
      ...data.assets.immovableAssets.flatMap((asset) => [asset.address, asset.surveyNumber, asset.registryDetails]),
    )
  }
  if (document.category === 'bank' || document.category === 'cas' || document.category === 'demat') {
    related.push(
      ...data.assets.bankAccounts.flatMap((account) => [account.bankName, account.branch]),
      ...data.assets.investments.flatMap((investment) => [investment.type, investment.identifier, investment.description]),
    )
  }
  if (document.category === 'insurance') {
    related.push(...data.insurance.policies.flatMap((policy) => [policy.insurer, policy.policyNumber, policy.nomineeName]))
  }

  return [document.fileName, document.category, metadataValues, document.reconciliationNotes.join(' '), related.join(' ')]
    .join(' ')
    .toLowerCase()
}

function buildSnippet(document: VaultDocument, tokens: string[]): string {
  const haystack = documentSearchableParts(document)
  for (const token of tokens) {
    const part = haystack.find((candidate) => candidate.toLowerCase().includes(token))
    if (part) return part
  }
  return `${document.category} document uploaded ${document.createdAt.slice(0, 10)}`
}

function documentSearchableParts(document: VaultDocument): string[] {
  return [
    document.fileName,
    ...Object.entries(document.extractedMetadata).map(([key, value]) => `${key}: ${value}`),
    ...document.reconciliationNotes,
  ].filter(Boolean)
}

export function searchVaultDocuments(data: WillData, query: string): DocumentSearchResult[] {
  const tokens = tokenizeQuery(query)
  if (tokens.length === 0) return []

  return data.documentVault.documents
    .map((document) => {
      const text = documentSearchText(document, data)
      const hits = tokens.filter((token) => text.includes(token))
      const score = hits.length / tokens.length
      return {
        documentId: document.id,
        fileName: document.fileName,
        category: document.category,
        snippet: buildSnippet(document, hits.length ? hits : tokens),
        score,
      }
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
}

export function summarizeSearchResults(results: DocumentSearchResult[], query: string): string {
  if (results.length === 0) {
    return `No documents in your vault match "${query}". Upload supporting documents in the Document Vault step to make them searchable.`
  }
  const lines = results.map(
    (result) => `${result.fileName} (${result.category}, ${Math.round(result.score * 100)}% match) — ${result.snippet}`,
  )
  return [`${results.length} document(s) match "${query}":`, ...lines].join('\n')
}
