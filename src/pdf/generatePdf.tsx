import { pdf } from '@react-pdf/renderer'
import type { ConsultationRequest, WillData } from '../lib/types'
import { EstateReportDocument, type EstateReportType } from './EstateReportDocument'
import { WillReportDocument } from './WillReportDocument'

function fileSlug(data: WillData, fallback: string) {
  return (data.personal.fullLegalName || fallback).trim().replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || fallback
}

export function willPdfFileName(data: WillData) {
  return `${fileSlug(data, 'octaraa-will-draft')}-will-draft.pdf`
}

export function estateReportFileName(data: WillData, type: EstateReportType) {
  return `${fileSlug(data, 'octaraa-estate')}-${type}-report.pdf`
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export async function downloadWillPdf(data: WillData, consultation?: ConsultationRequest | null) {
  const blob = await pdf(<WillReportDocument data={data} consultation={consultation} />).toBlob()
  saveBlob(blob, willPdfFileName(data))
}

export async function downloadEstateReportPdf(data: WillData, type: EstateReportType) {
  const blob = await pdf(<EstateReportDocument data={data} type={type} />).toBlob()
  saveBlob(blob, estateReportFileName(data, type))
}

async function toBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  return btoa(binary)
}

/** Renders a report to a base64 PDF attachment for automatic email distribution. */
export async function renderEstateReportAttachment(data: WillData, type: EstateReportType) {
  const blob = await pdf(<EstateReportDocument data={data} type={type} />).toBlob()
  return { name: estateReportFileName(data, type), contentBase64: await toBase64(blob) }
}
