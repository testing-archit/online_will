export type Religion =
  | 'hindu'
  | 'muslim'
  | 'christian'
  | 'parsi'
  | 'sikh'
  | 'jain'
  | 'buddhist'
  | 'other'

export type RelationshipType = 'spouse' | 'child' | 'parent' | 'other'

export interface PersonRef {
  id: string
  fullName: string
  age: string
  address: string
  relationship: string
}

export interface PersonalDetails {
  fullLegalName: string
  dateOfBirth: string
  addressLine: string
  pincode: string
  city: string
  state: string
  religion: Religion | ''
  religionOther: string
}

export interface RevocationCapacity {
  hasPriorWills: boolean | null
  revokesAllPrior: boolean
  soundMindDeclaration: boolean
  hasMedicalCertificate: boolean | null
}

export interface ExecutorInfo extends PersonRef {
  isAlternate: boolean
}

export interface GuardianInfo extends PersonRef {
  isAlternate: boolean
  financialInstructions: string
}

export type ExecutorCompensation = 'compensated' | 'uncompensated' | ''

export interface ChildInfo {
  id: string
  fullName: string
  age: string
}

export interface ExecutorsGuardians {
  executors: ExecutorInfo[]
  compensation: ExecutorCompensation
  hasChildren: boolean | null
  children: ChildInfo[]
  hasMinorChildren: boolean | null
  guardians: GuardianInfo[]
}

export interface ImmovableAsset {
  id: string
  address: string
  surveyNumber: string
  registryDetails: string
  ownershipShare: string
  estimatedValue?: string
}

export interface BankAccount {
  id: string
  bankName: string
  branch: string
  accountNumber: string
  estimatedValue?: string
  nomineeName?: string
}

export interface InvestmentAsset {
  id: string
  type: string
  identifier: string
  description: string
  estimatedValue?: string
  nomineeName?: string
}

export interface Valuable {
  id: string
  description: string
  estimatedValue: string
}

export type DebtSettlementMethod =
  | 'specific-asset'
  | 'estate-reserves'
  | 'before-distribution'
  | ''

export interface AssetInventory {
  immovableAssets: ImmovableAsset[]
  bankAccounts: BankAccount[]
  investments: InvestmentAsset[]
  valuables: Valuable[]
  hasEncumberedAssets: boolean | null
  encumbranceDetails: string
  debtSettlementMethod: DebtSettlementMethod
}

export interface InsurancePolicy {
  id: string
  insurer: string
  policyNumber: string
  nomineeName: string
  nomineeRelationship: RelationshipType | ''
  alignWithWill: boolean | null
}

export interface InsuranceNominations {
  hasPolicies: boolean | null
  policies: InsurancePolicy[]
}

export type DistributionScheme = 'all-in-one' | 'itemized' | 'percentage' | ''

export interface Beneficiary {
  id: string
  name: string
  relationship: RelationshipType | ''
  share: string
  substituteBeneficiary: string
  /** Ids of assets (immovable / bank / investment / valuable / policy) this beneficiary receives specifically. */
  assignedAssetIds?: string[]
}

export interface DistributionStrategy {
  scheme: DistributionScheme
  beneficiaries: Beneficiary[]
  hasFutureAssets: boolean | null
  futureAssetInstructions: string
  wantsSimultaneousDeathClause: boolean | null
  residuaryBeneficiary: string
}

export interface FuneralSettlement {
  funeralWishes: string
  payExpensesFromEstate: boolean | null
}

export interface Witness extends PersonRef {
  isAlsoBeneficiary: boolean | null
  idNumber: string
}

export interface ExecutionCompliance {
  witnesses: Witness[]
  plansVideoRecording: boolean | null
  isUttarakhandExecution: boolean | null
  acknowledgesCodicilProcess: boolean
}

export interface AssistantExtraction {
  id: string
  originalStatement: string
  assetDescription: string
  assetType: string
  intendedBeneficiary: string
  distributionInstruction: string
  confidence: number
  status: 'pending' | 'confirmed' | 'dismissed'
  createdAt: string
}

export interface InterviewMessage {
  id: string
  role: 'samaira' | 'user'
  content: string
  createdAt: string
}

export interface InterviewBeneficiaryProposal {
  id: string
  name: string
  relationship: RelationshipType | ''
  share: string
  specificBequest: string
  confidence: number
  status: 'pending' | 'confirmed' | 'dismissed'
}

/** A value Samaira proposes for an ordinary answer field on the questionnaire. Nothing is applied until the person confirms. */
export interface FieldUpdate {
  path: string
  value: string | boolean
}

export interface InterviewTurnProposal {
  id: string
  originalStatement: string
  assistantReply: string
  beneficiaries: InterviewBeneficiaryProposal[]
  followUpQuestion: string
  /** Proposed answers for fields on the step the person was on. Optional: older drafts and offline replies have none. */
  fieldUpdates?: FieldUpdate[]
  status: 'pending' | 'confirmed' | 'dismissed'
  createdAt: string
}

export interface AssistantIntake {
  extractions: AssistantExtraction[]
  interviewMessages: InterviewMessage[]
  interviewProposals: InterviewTurnProposal[]
}

export type VaultDocumentCategory =
  | 'pan'
  | 'id'
  | 'property'
  | 'bank'
  | 'cas'
  | 'demat'
  | 'insurance'
  | 'loan'
  | 'business'
  | 'vehicle'
  | 'existing-will'
  | 'unknown'

export type ExtractedAssetKind = 'immovable' | 'bank' | 'investment' | 'insurance' | 'valuable'

export interface ExtractedAsset {
  id: string
  kind: ExtractedAssetKind
  label: string
  identifier: string
  holder: string
  nominee: string
  value: string
  /** Never added to the estate silently — the user must accept or ignore each finding. */
  status: 'pending' | 'added' | 'ignored'
}

export interface VaultDocument {
  id: string
  fileName: string
  fileSize: number
  mimeType: string
  category: VaultDocumentCategory
  confidence: number
  extractedMetadata: Record<string, string>
  reconciliationNotes: string[]
  extractedAssets?: ExtractedAsset[]
  /** Server-side upload id of the stored original file, when the backend was reachable. */
  uploadId?: string
  status: 'uploaded' | 'classified' | 'needs_review' | 'confirmed'
  createdAt: string
}

export interface DocumentVault {
  documents: VaultDocument[]
}

export interface DigitalAssetInstruction {
  id: string
  accountType: string
  provider: string
  locationHint: string
  instruction: string
}

export interface EstateReviewEvent {
  id: string
  trigger: string
  dueDate: string
  status: 'pending' | 'completed' | 'dismissed'
  /** True once a reminder email has been queued with the scheduler. */
  reminderScheduled?: boolean
}

export interface CollaborationThread {
  id: string
  /** Server comment id, once synced. */
  serverId?: string
  senderRole: 'client' | 'lawyer' | 'advisor' | 'operations'
  kind?: 'comment' | 'document_request' | 'question' | 'approval' | 'correction'
  message: string
  status: 'open' | 'resolved'
  createdAt: string
}

export interface ExecutionChecklistItem {
  id: string
  label: string
  completed: boolean
}

export interface AuditTrailEntry {
  id: string
  actorRole: 'client' | 'lawyer' | 'advisor' | 'operations' | 'system'
  action: string
  entityType: string
  entityId?: string
  summary: string
  before?: string
  after?: string
  createdAt: string
}

export interface DocumentSearchResult {
  documentId: string
  fileName: string
  category: VaultDocumentCategory
  snippet: string
  score: number
}

export interface DocumentSearchHistoryItem {
  id: string
  query: string
  answer: string
  results: DocumentSearchResult[]
  createdAt: string
}

export interface LegalKnowledgeAnswer {
  id: string
  question: string
  answer: string
  sources: { id: string; title: string; citation: string }[]
  createdAt: string
}

export interface ExecutionVideoAnalysis {
  id: string
  fileName: string
  /** Stored recording (server upload id) so it stays associated with the Will version it was made for. */
  uploadId?: string
  /** Fingerprint of the draft text at the time the recording was attached. */
  willVersion?: string
  createdAt: string
  signingDetected: boolean | null
  witnessesPresent: boolean | null
  willReadingDetected: boolean | null
  participantNotes: string
  timelineNotes: string
  rawSummary: string
  status: 'pending_review' | 'reviewed'
}

export type PostDeathWorkflowStatus =
  | 'not_started'
  | 'death_reported'
  | 'executor_authenticated'
  | 'inventory_review'
  | 'distribution_tracking'

export interface EstateOs {
  copilotHistory: { id: string; question: string; answer: string; createdAt: string; source?: 'ai' | 'recorded' }[]
  scenarioHistory: { id: string; scenario: string; outcome: string; createdAt: string }[]
  /** Percentage what-if, keyed by beneficiary id. */
  distributionSimulation: Record<string, number>
  /** Asset what-if: asset id → beneficiary id. */
  assetSimulation: Record<string, string>
  generatedFollowUps: { id: string; question: string; status: 'open' | 'answered' | 'dismissed' }[]
  voiceInterviewNotes: string[]
  hinglishInterviewNotes: string[]
  lawyerComments: CollaborationThread[]
  executionChecklist: ExecutionChecklistItem[]
  executionRoomNotes: string
  executionRecordingMetadata: string
  digitalAssets: DigitalAssetInstruction[]
  reviewEvents: EstateReviewEvent[]
  postDeathWorkflowStatus: PostDeathWorkflowStatus
  postDeathWorkflowLog: { id: string; status: PostDeathWorkflowStatus; at: string; note: string }[]
  /** Where scheduled review reminders are emailed. */
  reminderEmail: string
  auditTrail: AuditTrailEntry[]
  documentSearchHistory: DocumentSearchHistoryItem[]
  legalKnowledgeHistory: LegalKnowledgeAnswer[]
  executionVideoAnalyses: ExecutionVideoAnalysis[]
}

export interface WillData {
  assistantIntake: AssistantIntake
  documentVault: DocumentVault
  estateOs: EstateOs
  personal: PersonalDetails
  revocation: RevocationCapacity
  executorsGuardians: ExecutorsGuardians
  assets: AssetInventory
  insurance: InsuranceNominations
  distribution: DistributionStrategy
  funeral: FuneralSettlement
  execution: ExecutionCompliance
}

export type FlagSeverity = 'critical' | 'warning' | 'info'

export interface LegalFlag {
  id: string
  severity: FlagSeverity
  title: string
  description: string
  sourceStepId: string
}

export interface ConsultationRequest {
  id: string
  willId?: string
  createdAt: string
  contactName: string
  contactPhone: string
  contactEmail: string
  preferredMode: 'video' | 'phone' | 'in-person' | ''
  preferredWindow: string
  notes: string
  flagsSnapshot: LegalFlag[]
}
