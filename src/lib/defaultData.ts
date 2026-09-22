import { newId } from './id'
import type { WillData } from './types'

export function emptyPerson() {
  return {
    id: newId(),
    fullName: '',
    age: '',
    address: '',
    relationship: '',
  }
}

export function defaultWillData(): WillData {
  return {
    assistantIntake: {
      extractions: [],
      // Empty on purpose: Samaira opens the conversation herself, on the step the person is on and in their language.
      interviewMessages: [],
      interviewProposals: [],
    },
    documentVault: {
      documents: [],
    },
    estateOs: {
      copilotHistory: [],
      scenarioHistory: [],
      distributionSimulation: {},
      assetSimulation: {},
      generatedFollowUps: [],
      voiceInterviewNotes: [],
      hinglishInterviewNotes: [],
      lawyerComments: [],
      executionChecklist: [
        { id: 'final-will-approved', label: 'Final Will approved', completed: false },
        { id: 'testator-id', label: 'Testator ID collected', completed: false },
        { id: 'pan', label: 'PAN collected', completed: false },
        { id: 'witness-1', label: 'Witness 1 confirmed', completed: false },
        { id: 'witness-2', label: 'Witness 2 confirmed', completed: false },
        { id: 'medical-certificate', label: 'Medical certificate reviewed', completed: false },
        { id: 'registration-appointment', label: 'Registration appointment scheduled', completed: false },
        { id: 'registration-completed', label: 'Registration completed', completed: false },
      ],
      executionRoomNotes: '',
      executionRecordingMetadata: '',
      digitalAssets: [],
      reviewEvents: [],
      postDeathWorkflowStatus: 'not_started',
      postDeathWorkflowLog: [],
      reminderEmail: '',
      auditTrail: [],
      documentSearchHistory: [],
      legalKnowledgeHistory: [],
      executionVideoAnalyses: [],
    },
    personal: {
      fullLegalName: '',
      dateOfBirth: '',
      addressLine: '',
      pincode: '',
      city: '',
      state: '',
      religion: '',
      religionOther: '',
    },
    revocation: {
      hasPriorWills: null,
      revokesAllPrior: false,
      soundMindDeclaration: false,
      hasMedicalCertificate: null,
    },
    executorsGuardians: {
      executors: [{ ...emptyPerson(), isAlternate: false }],
      compensation: '',
      hasChildren: null,
      children: [],
      hasMinorChildren: null,
      guardians: [],
    },
    assets: {
      immovableAssets: [],
      bankAccounts: [],
      investments: [],
      valuables: [],
      hasEncumberedAssets: null,
      encumbranceDetails: '',
      debtSettlementMethod: '',
    },
    insurance: {
      hasPolicies: null,
      policies: [],
    },
    distribution: {
      scheme: '',
      beneficiaries: [],
      hasFutureAssets: null,
      futureAssetInstructions: '',
      wantsSimultaneousDeathClause: null,
      residuaryBeneficiary: '',
    },
    funeral: {
      funeralWishes: '',
      payExpensesFromEstate: null,
    },
    execution: {
      witnesses: [
        { ...emptyPerson(), isAlsoBeneficiary: null, idNumber: '' },
        { ...emptyPerson(), isAlsoBeneficiary: null, idNumber: '' },
      ],
      plansVideoRecording: null,
      isUttarakhandExecution: null,
      acknowledgesCodicilProcess: false,
    },
  }
}
