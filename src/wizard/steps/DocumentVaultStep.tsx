import { AlertTriangle, Check, Download, FileUp, Loader2, Plus, RefreshCw, Search, ShieldCheck, Trash2, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useFormContext } from 'react-hook-form'
import {
  analyzeDocumentWithBackend,
  deleteStoredFile,
  downloadStoredFile,
  searchDocumentsWithBackend,
  storeFileOnBackend,
} from '../../lib/backendClient'
import {
  acceptExtractedAsset,
  CATEGORY_LABEL,
  classifyDocument,
  confirmDocument,
  formatFileSize,
  ignoreExtractedAsset,
  mergeBackendAnalysis,
  recategorizeDocument,
  refreshReconciliation,
  VAULT_CATEGORIES,
} from '../../lib/documentIntelligence'
import { searchVaultDocuments, summarizeSearchResults } from '../../lib/documentSearch'
import { newId } from '../../lib/id'
import type { VaultDocument, VaultDocumentCategory, WillData } from '../../lib/types'
import { SelectInput, TextInput } from '../fields'

const MAX_FILE_BYTES = 100 * 1024 * 1024

interface UploadProgress {
  id: string
  name: string
  state: 'uploading' | 'analyzing' | 'done' | 'error'
  message: string
}

export function DocumentVaultStep() {
  const { watch, setValue, getValues } = useFormContext<WillData>()
  const data = watch()
  const inputRef = useRef<HTMLInputElement>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [progress, setProgress] = useState<UploadProgress[]>([])
  const [downloadError, setDownloadError] = useState('')

  const patchProgress = (id: string, patch: Partial<UploadProgress>) =>
    setProgress((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)))

  async function runSearch() {
    if (!searchQuery.trim()) return
    setIsSearching(true)
    try {
      const current = getValues()
      const backendSearch = await searchDocumentsWithBackend(searchQuery, current)
      const results = backendSearch?.results ?? searchVaultDocuments(current, searchQuery)
      const answer = backendSearch?.answer ?? summarizeSearchResults(results, searchQuery)
      const latest = getValues()
      setValue(
        'estateOs.documentSearchHistory',
        [{ id: newId(), query: searchQuery, answer, results, createdAt: new Date().toISOString() }, ...latest.estateOs.documentSearchHistory].slice(0, 30),
        { shouldDirty: true },
      )
      setSearchQuery('')
    } finally {
      setIsSearching(false)
    }
  }

  async function processFile(file: File) {
    const rowId = newId()
    setProgress((rows) => [{ id: rowId, name: file.name, state: 'uploading', message: 'Storing securely…' }, ...rows])

    if (file.size > MAX_FILE_BYTES) {
      patchProgress(rowId, { state: 'error', message: `Larger than ${formatFileSize(MAX_FILE_BYTES)} — not uploaded.` })
      return
    }

    try {
      let document = classifyDocument(file, getValues())

      // 1. Store the original (signed upload). If the backend is unreachable the metadata is still kept locally.
      const uploadId = await storeFileOnBackend(file, document.category)
      if (uploadId) document = { ...document, uploadId }

      // 2. AI classification / extraction, by reference to the stored file (no bytes re-sent in the request).
      patchProgress(rowId, { state: 'analyzing', message: uploadId ? 'Classifying and extracting…' : 'Server unavailable — classified from the file name only.' })
      const analysis = uploadId ? await analyzeDocumentWithBackend({ fileName: file.name, mimeType: file.type || 'application/octet-stream', uploadId }, getValues()) : null
      document = mergeBackendAnalysis(document, analysis, getValues())

      // Re-read the form: other edits may have happened while the file was processing.
      setValue('documentVault.documents', [document, ...getValues().documentVault.documents], { shouldDirty: true })
      patchProgress(rowId, {
        state: 'done',
        message: uploadId ? (analysis ? 'Done — review the result below.' : 'Stored. AI analysis unavailable; classified from the file name.') : 'Added locally (not stored on the server).',
      })
    } catch (error) {
      patchProgress(rowId, { state: 'error', message: error instanceof Error ? error.message : 'Upload failed.' })
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return
    const list = Array.from(files)
    if (inputRef.current) inputRef.current.value = ''
    // Sequential: keeps the stored order predictable and avoids hammering the AI provider.
    for (const file of list) await processFile(file)
  }

  function updateDocument(id: string, change: (document: VaultDocument) => VaultDocument) {
    setValue(
      'documentVault.documents',
      getValues().documentVault.documents.map((document) => (document.id === id ? change(document) : document)),
      { shouldDirty: true },
    )
  }

  async function removeDocument(document: VaultDocument) {
    if (!window.confirm(`Remove "${document.fileName}" from your vault? The stored file is deleted.`)) return
    if (document.uploadId) await deleteStoredFile(document.uploadId)
    setValue(
      'documentVault.documents',
      getValues().documentVault.documents.filter((item) => item.id !== document.id),
      { shouldDirty: true },
    )
  }

  async function download(document: VaultDocument) {
    setDownloadError('')
    if (!document.uploadId || !(await downloadStoredFile(document.uploadId, document.fileName))) {
      setDownloadError(`Could not download "${document.fileName}" — the stored copy is unavailable.`)
    }
  }

  function acceptAsset(documentId: string, assetId: string) {
    const next = acceptExtractedAsset(getValues(), documentId, assetId)
    setValue('assets', next.assets, { shouldDirty: true })
    setValue('insurance', next.insurance, { shouldDirty: true })
    setValue('documentVault', next.documentVault, { shouldDirty: true })
  }

  const documents = data.documentVault.documents

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
          <p>
            Files are stored in your private vault and only you (and the lawyer assigned to your case) can open them.
            Each document is classified automatically; you can correct the category, and nothing extracted from a
            document is added to your estate until you confirm it.
          </p>
        </div>
      </div>

      <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center transition hover:border-brand-secondary hover:bg-brand-primary/5 focus-within:border-brand-secondary">
        <FileUp className="h-8 w-8 text-brand-primary" />
        <span className="mt-3 text-sm font-semibold text-slate-800">Upload documents</span>
        <span className="mt-1 text-xs text-slate-500">PAN, ID, property, bank, CAS, demat, insurance, loan, business, vehicle, prior Will</span>
        <input ref={inputRef} type="file" multiple className="sr-only" onChange={(event) => void handleFiles(event.target.files)} />
      </label>

      {progress.length > 0 && (
        <ul className="space-y-1.5" aria-live="polite">
          {progress.slice(0, 5).map((row) => (
            <li
              key={row.id}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
                row.state === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : row.state === 'done' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-600'
              }`}
            >
              {row.state === 'uploading' || row.state === 'analyzing' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : row.state === 'error' ? <AlertTriangle className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
              <span className="font-semibold">{row.name}</span>
              <span>— {row.message}</span>
            </li>
          ))}
        </ul>
      )}
      {downloadError && <p className="text-xs text-rose-600">{downloadError}</p>}

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <Search className="h-4 w-4 text-brand-primary" />
          <h3 className="text-sm font-semibold text-slate-900">AI document search</h3>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Searches only your authorized vault — e.g. "find my insurance policy" or "everything related to my Noida property".
        </p>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <TextInput
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void runSearch()
              }
            }}
            placeholder="Ask about your uploaded documents…"
            aria-label="Search your documents"
          />
          <button
            type="button"
            onClick={() => void runSearch()}
            disabled={isSearching || !searchQuery.trim()}
            className="rounded-xl bg-brand-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {isSearching ? 'Searching…' : 'Search'}
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {data.estateOs.documentSearchHistory.slice(0, 3).map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
              <p className="text-sm font-semibold text-slate-800">{item.query}</p>
              <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{item.answer}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        {documents.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-400">
            Uploaded documents, their classification and reconciliation notes will appear here.
          </p>
        )}
        {documents.map((document) => (
          <div key={document.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">{document.fileName}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {formatFileSize(document.fileSize)} · {Math.round(document.confidence * 100)}% confidence ·{' '}
                  {document.uploadId ? 'stored in your vault' : 'not stored on the server'}
                </p>
              </div>
              <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-500">
                {document.status.replace('_', ' ')}
              </span>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-[220px_1fr] sm:items-end">
              <label className="block text-xs font-medium text-slate-600">
                Document type (correct it if it is wrong)
                <div className="mt-1">
                  <SelectInput
                    value={document.category}
                    onChange={(event) =>
                      updateDocument(document.id, (item) => recategorizeDocument(item, event.target.value as VaultDocumentCategory, getValues()))
                    }
                  >
                    {VAULT_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {CATEGORY_LABEL[category]}
                      </option>
                    ))}
                  </SelectInput>
                </div>
              </label>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {Object.entries(document.extractedMetadata).map(([key, value]) => (
                <div key={key} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{key}</p>
                  <p className="mt-1 break-words text-sm text-slate-700">{String(value || '') || 'Not detected'}</p>
                </div>
              ))}
            </div>

            {document.reconciliationNotes.length > 0 && (
              <div className="mt-3 space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                {document.reconciliationNotes.map((note) => (
                  <p key={note} className="text-xs text-amber-900">
                    ⚠ {note}
                  </p>
                ))}
              </div>
            )}

            {(document.extractedAssets ?? []).some((asset) => asset.status === 'pending') && (
              <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-3">
                <p className="text-sm font-semibold text-sky-950">We found these assets in this document. Add them to your estate?</p>
                <ul className="mt-2 space-y-2">
                  {(document.extractedAssets ?? [])
                    .filter((asset) => asset.status === 'pending')
                    .map((asset) => (
                      <li key={asset.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-100 bg-white px-3 py-2">
                        <div className="text-xs text-slate-700">
                          <p className="text-sm font-semibold text-slate-900">{asset.label || asset.identifier}</p>
                          <p>
                            {[asset.kind, asset.identifier && `ID ${asset.identifier}`, asset.holder && `holder ${asset.holder}`, asset.nominee && `nominee ${asset.nominee}`, asset.value && `value ${asset.value}`]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => acceptAsset(document.id, asset.id)}
                            className="inline-flex items-center gap-1 rounded-full bg-brand-primary px-3 py-1 text-xs font-semibold text-white"
                          >
                            <Plus className="h-3.5 w-3.5" /> Add to estate
                          </button>
                          <button
                            type="button"
                            onClick={() => updateDocument(document.id, (item) => ignoreExtractedAsset(item, asset.id))}
                            className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-500"
                          >
                            <X className="h-3.5 w-3.5" /> Ignore
                          </button>
                        </div>
                      </li>
                    ))}
                </ul>
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {document.status !== 'confirmed' && (
                <button
                  type="button"
                  onClick={() => updateDocument(document.id, confirmDocument)}
                  className="inline-flex items-center gap-1 rounded-full bg-brand-primary px-3 py-1.5 text-xs font-semibold text-white"
                >
                  <Check className="h-3.5 w-3.5" />
                  Confirm classification
                </button>
              )}
              <button
                type="button"
                onClick={() => updateDocument(document.id, (item) => refreshReconciliation(item, getValues()))}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Re-check against my answers
              </button>
              {document.uploadId && (
                <button
                  type="button"
                  onClick={() => void download(document)}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600"
                >
                  <Download className="h-3.5 w-3.5" /> Download original
                </button>
              )}
              <button
                type="button"
                onClick={() => void removeDocument(document)}
                className="inline-flex items-center gap-1 rounded-full border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600"
              >
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </button>
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}
