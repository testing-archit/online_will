import knowledge from '../../shared/legal-knowledge.json'

export interface LegalKnowledgeSource {
  id: string
  title: string
  citation: string
  version: string
  keywords: string[]
  content: string
}

// The knowledge base lives in shared/legal-knowledge.json so the server (which
// owns the approved sources at answer time) and this offline fallback can never drift apart.
export const LEGAL_KNOWLEDGE_BASE_VERSION: string = knowledge.version

// Approved, curated source material only. The retrieval layer below never
// allows the model to answer outside these excerpts — this is the control
// that keeps the assistant from inventing legal rules.
export const LEGAL_KNOWLEDGE_BASE: LegalKnowledgeSource[] = knowledge.sources

export interface RetrievedSource {
  id: string
  title: string
  citation: string
  relevance: number
}

export function retrieveLegalSources(question: string): RetrievedSource[] {
  const tokens = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2)

  return LEGAL_KNOWLEDGE_BASE.map((source) => {
    // Whole-word or stem matches only ("can" must not hit "cancel").
    const hits = source.keywords.filter((keyword) =>
      tokens.some(
        (token) => token === keyword || (token.length >= 4 && keyword.startsWith(token)) || (keyword.length >= 4 && token.startsWith(keyword)),
      ),
    )
    const relevance = hits.length / Math.max(source.keywords.length, 1) + hits.length * 0.05
    return { id: source.id, title: source.title, citation: source.citation, relevance }
  })
    .filter((source) => source.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 3)
}

export function answerFromKnowledgeBase(question: string): { answer: string; sources: RetrievedSource[] } {
  const sources = retrieveLegalSources(question)
  if (sources.length === 0) {
    return {
      answer:
        'No approved source in the Octaraa legal knowledge base covers this question. This assistant only answers from reviewed material — please raise this with the consulting lawyer so a curated answer can be added.',
      sources: [],
    }
  }

  const excerpts = sources.map((source) => {
    const record = LEGAL_KNOWLEDGE_BASE.find((item) => item.id === source.id)
    return `${source.title} (${source.citation}):\n${record?.content ?? ''}`
  })

  return {
    answer: ['Based on the approved Octaraa legal knowledge base:', '', ...excerpts, '', 'This is general information from curated sources, not legal advice for your specific situation.'].join('\n'),
    sources,
  }
}
