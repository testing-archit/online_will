import { buildEstateProfile } from './estateProfile'
import { computeLegalFlags } from './legalRules'
import type { ConsultationRequest, WillData } from './types'

export type NotificationEvent =
  | 'questionnaire_completed'
  | 'submission_confirmation'
  | 'document_request'
  | 'missing_information_reminder'
  | 'lawyer_assignment'
  | 'draft_ready'
  | 'review_required'
  | 'execution_scheduled'

export type NotificationAudience = 'client' | 'advisor' | 'lawyer' | 'operations'

export interface NotificationJob {
  id: string
  event: NotificationEvent
  audience: NotificationAudience
  templateId: string
  subject: string
  preview: string
  payload: Record<string, unknown>
  /** Optional generated report sent with the email (see ConsultationStep). */
  attachment?: { name: string; contentBase64: string }
}

export function buildNotificationWorkflow(data: WillData, consultation?: ConsultationRequest | null): NotificationJob[] {
  const profile = buildEstateProfile(data)
  const flags = computeLegalFlags(data)
  const criticalCount = flags.filter((flag) => flag.severity === 'critical').length
  const missingCount = profile.missingInformation.length
  const clientName = data.personal.fullLegalName || consultation?.contactName || 'Octaraa client'

  const commonPayload = {
    clientName,
    completion: profile.completion.overall,
    criticalCount,
    missingCount,
    preferredWindow: consultation?.preferredWindow ?? '',
  }

  const jobs: NotificationJob[] = [
    {
      id: 'submission-confirmation-client',
      event: 'submission_confirmation',
      audience: 'client',
      templateId: 'will_submission_confirmation_v1',
      subject: 'Your Octaraa Will information has been received',
      preview: `We recorded your estate profile at ${profile.completion.overall}% workflow completion.`,
      payload: commonPayload,
    },
    {
      id: 'advisor-report-ready',
      event: 'questionnaire_completed',
      audience: 'advisor',
      templateId: 'advisor_report_ready_v1',
      subject: `${clientName}: estate profile ready for advisor review`,
      preview: `${profile.assets.length} asset item(s), ${profile.beneficiaries.length} beneficiary item(s), ${missingCount} open item(s).`,
      payload: commonPayload,
    },
    {
      id: 'lawyer-review-required',
      event: criticalCount > 0 ? 'review_required' : 'draft_ready',
      audience: 'lawyer',
      templateId: criticalCount > 0 ? 'lawyer_review_required_v1' : 'lawyer_brief_ready_v1',
      subject: `${clientName}: lawyer brief ${criticalCount > 0 ? 'requires review' : 'ready'}`,
      preview: `${criticalCount} critical flag(s), ${flags.length} total legal consideration(s).`,
      payload: {
        ...commonPayload,
        flagIds: flags.map((flag) => flag.id),
      },
    },
  ]

  if (profile.documents.length > 0) {
    jobs.push({
      id: 'document-request-client',
      event: 'document_request',
      audience: 'client',
      templateId: 'document_request_v1',
      subject: 'Documents requested for your Will review',
      preview: `${profile.documents.length} supporting document category/categories requested.`,
      payload: {
        ...commonPayload,
        documents: profile.documents.map((document) => document.title),
      },
    })
  }

  if (missingCount > 0) {
    jobs.push({
      id: 'missing-info-reminder-client',
      event: 'missing_information_reminder',
      audience: 'client',
      templateId: 'missing_information_reminder_v1',
      subject: 'A few details are still needed for your Will draft',
      preview: `${missingCount} item(s) need completion or review.`,
      payload: {
        ...commonPayload,
        missingItems: profile.missingInformation.map((item) => item.title),
      },
    })
  }

  if (consultation) {
    jobs.push({
      id: 'lawyer-assignment-ops',
      event: 'lawyer_assignment',
      audience: 'operations',
      templateId: 'lawyer_assignment_v1',
      subject: `${clientName}: assign lawyer for consultation`,
      preview: consultation.preferredWindow || 'No preferred window provided.',
      payload: {
        ...commonPayload,
        consultationId: consultation.id,
        contactPhone: consultation.contactPhone,
        contactEmail: consultation.contactEmail,
        preferredMode: consultation.preferredMode,
      },
    })
  }

  if (data.execution.isUttarakhandExecution || data.execution.plansVideoRecording) {
    jobs.push({
      id: 'execution-scheduled-checklist',
      event: 'execution_scheduled',
      audience: 'operations',
      templateId: 'execution_scheduled_checklist_v1',
      subject: `${clientName}: execution workflow checklist`,
      preview: data.execution.isUttarakhandExecution
        ? 'Registration path needs scheduling support.'
        : 'Video recording preference needs coordination.',
      payload: commonPayload,
    })
  }

  return jobs
}
