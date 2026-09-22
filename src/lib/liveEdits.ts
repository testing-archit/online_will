import lists from '../../shared/live-lists.json'
import { emptyPerson } from './defaultData'
import { newId } from './id'
import { getPathValue } from './questionnaireSchema'
import type { WillData } from './types'

/**
 * Editing the repeating lists of the Will (executors, assets, witnesses…) by voice. The list catalogue lives in
 * shared/live-lists.json so the server can tell the model exactly what exists, and this file is the only thing that
 * ever changes the form from it. Model output is untrusted: lists and fields are whitelisted, values are coerced to
 * the field's type, and an item is only ever matched by what the person calls it.
 */

interface FieldSpec {
  kind: 'text' | 'yes-no' | 'select'
  label: string
  options?: string[]
}
interface ListSpec {
  path: string
  step: string
  noun: string
  identity: string
  requires?: { path: string; value: unknown; because: string }
  fields: Record<string, FieldSpec>
}

export const LIVE_LISTS = lists as Record<string, ListSpec>
const MAX_TEXT = 200
const MAX_ITEMS = 25

/** Lists with a fixed number of slots on screen (the two attesting witnesses): fill and clear, never append. */
const FIXED_SLOTS = new Set(['witnesses'])

const NEW_ITEM: Record<string, (existing: number) => Record<string, unknown>> = {
  executors: (existing) => ({ ...emptyPerson(), isAlternate: existing > 0 }),
  children: () => ({ id: newId(), fullName: '', age: '' }),
  guardians: (existing) => ({ ...emptyPerson(), isAlternate: existing > 0, financialInstructions: '' }),
  immovableAssets: () => ({ id: newId(), address: '', surveyNumber: '', registryDetails: '', ownershipShare: '' }),
  bankAccounts: () => ({ id: newId(), bankName: '', branch: '', accountNumber: '' }),
  investments: () => ({ id: newId(), type: '', identifier: '', description: '' }),
  valuables: () => ({ id: newId(), description: '', estimatedValue: '' }),
  policies: () => ({ id: newId(), insurer: '', policyNumber: '', nomineeName: '', nomineeRelationship: '', alignWithWill: null }),
  beneficiaries: () => ({ id: newId(), name: '', relationship: '', share: '', substituteBeneficiary: '', assignedAssetIds: [] }),
  witnesses: () => ({ ...emptyPerson(), isAlsoBeneficiary: null, idNumber: '' }),
}

export interface ListEdit {
  list: unknown
  action: unknown
  /** What the person calls the item (a name, a bank), or its position ("1", "2"). Not needed to add. */
  match?: unknown
  values?: unknown
}

export type ListEditResult =
  | { ok: true; data: WillData; summary: string; /** Top-level sections of the form that changed. */ touched: string[]; /** Form path of the item that was added or changed, for highlighting. */ focus: string }
  | { ok: false; error: string }

function cleanText(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null
  const text = [...String(raw)].filter((char) => char === ' ' || char.charCodeAt(0) >= 32).join('').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, MAX_TEXT) : null
}

function coerce(field: FieldSpec, raw: unknown): string | boolean | null {
  if (field.kind === 'yes-no') {
    if (typeof raw === 'boolean') return raw
    const text = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
    if (['yes', 'true', 'haan', 'ha'].includes(text)) return true
    if (['no', 'false', 'nahi', 'nahin'].includes(text)) return false
    return null
  }
  const text = cleanText(raw)
  if (text === null) return null
  if (field.kind === 'select') return field.options?.find((option) => option === text.toLowerCase()) ?? null
  return text
}

/** Resolve an item from what the person said. Exact name first, then a part of it, then a 1-based position. */
function findItem(items: Record<string, unknown>[], identity: string, raw: unknown): { index: number } | { error: string } {
  const wanted = cleanText(raw)?.toLowerCase()
  const names = items.map((item) => String(item[identity] ?? '').trim())
  if (!wanted) {
    if (items.length === 1) return { index: 0 }
    return { error: items.length ? `Which one? They are: ${names.map((name, index) => `${index + 1}. ${name || '(blank)'}`).join('; ')}.` : 'There is nothing in that list yet.' }
  }
  const exact = names.flatMap((name, index) => (name.toLowerCase() === wanted ? [index] : []))
  if (exact.length === 1) return { index: exact[0] }
  const partial = names.flatMap((name, index) => (name && (name.toLowerCase().includes(wanted) || wanted.includes(name.toLowerCase())) ? [index] : []))
  if (partial.length === 1) return { index: partial[0] }
  if (partial.length > 1 || exact.length > 1) return { error: `More than one matches "${wanted}": ${names.join('; ')}. Ask which, or use its position.` }
  const position = Number(wanted)
  if (Number.isInteger(position) && position >= 1 && position <= items.length) return { index: position - 1 }
  return { error: `Nothing called "${wanted}" in that list. It has: ${names.map((name) => name || '(blank)').join('; ') || 'nothing yet'}.` }
}

function setAt(data: WillData, path: string, value: unknown): WillData {
  const clone = structuredClone(data) as unknown as Record<string, unknown>
  const keys = path.split('.')
  let node = clone
  for (const key of keys.slice(0, -1)) node = node[key] as Record<string, unknown>
  node[keys[keys.length - 1]] = value
  return clone as unknown as WillData
}

function describeFields(spec: ListSpec, names: string[]) {
  return names.map((name) => spec.fields[name]?.label.toLowerCase() ?? name).join(', ')
}

export function applyListEdit(data: WillData, edit: ListEdit): ListEditResult {
  const listId = typeof edit.list === 'string' ? edit.list : ''
  const spec = LIVE_LISTS[listId]
  if (!spec) return { ok: false, error: `Unknown list "${String(edit.list)}". Use one of: ${Object.keys(LIVE_LISTS).join(', ')}.` }
  const action = edit.action
  if (action !== 'add' && action !== 'update' && action !== 'remove') return { ok: false, error: 'action must be add, update or remove.' }
  if (spec.requires && getPathValue(data, spec.requires.path) !== spec.requires.value) return { ok: false, error: spec.requires.because }

  const current = getPathValue(data, spec.path)
  const items = (Array.isArray(current) ? current : []) as Record<string, unknown>[]
  const topLevel = spec.path.split('.')[0]

  // Only whitelisted fields, coerced to their type.
  const values: Record<string, string | boolean> = {}
  const ignored: string[] = []
  if (edit.values && typeof edit.values === 'object' && !Array.isArray(edit.values)) {
    for (const [key, raw] of Object.entries(edit.values as Record<string, unknown>)) {
      const field = spec.fields[key]
      const value = field ? coerce(field, raw) : null
      if (field && value !== null) values[key] = value
      else if (raw !== undefined && raw !== null && raw !== '') ignored.push(key)
    }
  }
  const valueNames = Object.keys(values)
  const noteIgnored = ignored.length ? ` (ignored: ${ignored.join(', ')})` : ''

  if (action === 'remove') {
    const found = findItem(items, spec.identity, edit.match)
    if ('error' in found) return { ok: false, error: found.error }
    const name = String(items[found.index][spec.identity] ?? '').trim() || `${spec.noun} ${found.index + 1}`
    if (FIXED_SLOTS.has(listId)) {
      const blank = { ...NEW_ITEM[listId](0), id: items[found.index].id }
      return { ok: true, data: setAt(data, spec.path, items.map((item, index) => (index === found.index ? blank : item))), summary: `Cleared ${spec.noun} "${name}"`, touched: [topLevel], focus: `${spec.path}.${found.index}` }
    }
    return { ok: true, data: setAt(data, spec.path, items.filter((_, index) => index !== found.index)), summary: `Removed ${spec.noun} "${name}"`, touched: [topLevel], focus: spec.path }
  }

  if (!valueNames.length) return { ok: false, error: `Nothing valid to ${action}. The fields for a ${spec.noun} are: ${Object.entries(spec.fields).map(([key, field]) => `${key} (${field.label})`).join('; ')}.` }

  const identityValue = typeof values[spec.identity] === 'string' ? (values[spec.identity] as string) : ''
  let index = -1
  if (action === 'update') {
    const found = findItem(items, spec.identity, edit.match ?? (identityValue || undefined))
    if ('error' in found) return { ok: false, error: found.error }
    index = found.index
  } else if (identityValue) {
    // Saying the same thing twice must not create a duplicate.
    const same = items.findIndex((item) => String(item[spec.identity] ?? '').trim().toLowerCase() === identityValue.toLowerCase())
    if (same >= 0) index = same
  }

  if (index >= 0) {
    const label = String(items[index][spec.identity] ?? '').trim() || identityValue || `${spec.noun} ${index + 1}`
    // Saying "hdfc bank" for an entry stored as "HDFC Bank" is the same entry: keep how it was written.
    const merged = { ...values }
    if (String(items[index][spec.identity] ?? '').trim().toLowerCase() === identityValue.toLowerCase()) delete merged[spec.identity]
    const changed = Object.keys(merged).filter((name) => items[index][name] !== merged[name])
    const next = items.map((item, at) => (at === index ? { ...item, ...merged } : item))
    return { ok: true, data: setAt(data, spec.path, next), summary: `Updated ${spec.noun} "${label}": ${describeFields(spec, changed.length ? changed : valueNames)}${noteIgnored}`, touched: [topLevel], focus: `${spec.path}.${index}` }
  }

  // Add.
  if (FIXED_SLOTS.has(listId)) {
    const free = items.findIndex((item) => !String(item[spec.identity] ?? '').trim())
    if (free < 0) return { ok: false, error: `Both ${spec.noun} places are already filled. Update one instead: ${items.map((item) => String(item[spec.identity])).join('; ')}.` }
    const next = items.map((item, at) => (at === free ? { ...item, ...values } : item))
    return { ok: true, data: setAt(data, spec.path, next), summary: `Added ${spec.noun} "${identityValue || free + 1}"${noteIgnored}`, touched: [topLevel], focus: `${spec.path}.${free}` }
  }
  // The form starts with an empty row in some lists: use it rather than leave a blank one above the new entry.
  const blank = items.findIndex((item) => Object.keys(spec.fields).every((name) => item[name] === undefined || item[name] === '' || item[name] === null || (name === 'isAlternate' && item[name] === false)))
  if (blank >= 0) {
    const next = items.map((item, at) => (at === blank ? { ...item, ...values } : item))
    return { ok: true, data: setAt(data, spec.path, next), summary: `Added ${spec.noun}${identityValue ? ` "${identityValue}"` : ''}: ${describeFields(spec, valueNames)}${noteIgnored}`, touched: [topLevel], focus: `${spec.path}.${blank}` }
  }
  if (items.length >= MAX_ITEMS) return { ok: false, error: `That list already has ${MAX_ITEMS} entries.` }
  const created = { ...NEW_ITEM[listId](items.length), ...values }
  return { ok: true, data: setAt(data, spec.path, [...items, created]), summary: `Added ${spec.noun}${identityValue ? ` "${identityValue}"` : ''}: ${describeFields(spec, valueNames)}${noteIgnored}`, touched: [topLevel], focus: `${spec.path}.${items.length}` }
}

/** What Samaira should know about the lists on a step: what is in each, and what can be said about an entry. */
export function listsOnStep(data: WillData, stepId: string) {
  return Object.entries(LIVE_LISTS)
    .filter(([, spec]) => spec.step === stepId)
    .map(([id, spec]) => {
      const current = getPathValue(data, spec.path)
      const items = (Array.isArray(current) ? current : []) as Record<string, unknown>[]
      return {
        list: id,
        noun: spec.noun,
        available: !spec.requires || getPathValue(data, spec.requires.path) === spec.requires.value,
        ...(spec.requires && getPathValue(data, spec.requires.path) !== spec.requires.value ? { unlock: spec.requires.because } : {}),
        entries: items.map((item, index) => String(item[spec.identity] ?? '').trim() || `(blank ${spec.noun} ${index + 1})`),
        fields: Object.keys(spec.fields),
      }
    })
}
