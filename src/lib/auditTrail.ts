import { newId } from './id'
import type { AuditTrailEntry, WillData } from './types'

export function createAuditEntry(
  entry: Omit<AuditTrailEntry, 'id' | 'createdAt'> & { createdAt?: string },
): AuditTrailEntry {
  return {
    id: newId(),
    createdAt: entry.createdAt ?? new Date().toISOString(),
    ...entry,
  }
}

const AUDITED_SECTIONS = [
  'personal',
  'revocation',
  'executorsGuardians',
  'assets',
  'insurance',
  'distribution',
  'funeral',
  'execution',
] as const

function sectionSnapshot(data: WillData, section: (typeof AUDITED_SECTIONS)[number]): string {
  return JSON.stringify(data[section])
}

// Field-level diff between two saved Will drafts. Used when a draft is saved
// so the compliance trail captures who changed what, before → after.
export function diffWillSections(before: WillData | null, after: WillData): AuditTrailEntry[] {
  if (!before) {
    return [
      createAuditEntry({
        actorRole: 'client',
        action: 'create',
        entityType: 'will',
        summary: 'Will draft created',
      }),
    ]
  }

  const entries: AuditTrailEntry[] = []
  for (const section of AUDITED_SECTIONS) {
    const previous = sectionSnapshot(before, section)
    const next = sectionSnapshot(after, section)
    if (previous !== next) {
      entries.push(
        createAuditEntry({
          actorRole: 'client',
          action: 'update',
          entityType: `will.${section}`,
          summary: `${section} section changed`,
          before: summarizeDiff(previous),
          after: summarizeDiff(next),
        }),
      )
    }
  }
  return entries
}

function summarizeDiff(snapshot: string): string {
  return snapshot.length > 400 ? `${snapshot.slice(0, 400)}…` : snapshot
}

export function appendAuditEntries(data: WillData, entries: AuditTrailEntry[], limit = 200): WillData['estateOs']['auditTrail'] {
  return [...entries, ...data.estateOs.auditTrail].slice(0, limit)
}
