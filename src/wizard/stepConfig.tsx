import {
  Banknote,
  FileSignature,
  Flower2,
  LayoutDashboard,
  MessageCircleHeart,
  PieChart,
  ScrollText,
  ShieldCheck,
  UserCircle2,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { AssetsStep } from './steps/AssetsStep'
import { ConsultationStep } from './steps/ConsultationStep'
import { DistributionStep } from './steps/DistributionStep'
import { DocumentVaultStep } from './steps/DocumentVaultStep'
import { EstateProfileStep } from './steps/EstateProfileStep'
import { EstateOsStep } from './steps/EstateOsStep'
import { ExecutionStep } from './steps/ExecutionStep'
import { ExecutorsGuardiansStep } from './steps/ExecutorsGuardiansStep'
import { FuneralStep } from './steps/FuneralStep'
import { InsuranceStep } from './steps/InsuranceStep'
import { PersonalStep } from './steps/PersonalStep'
import { RevocationStep } from './steps/RevocationStep'
import { ReviewStep } from './steps/ReviewStep'

export interface StepDef {
  id: string
  title: string
  subtitle: string
  Component: ComponentType
  Icon: LucideIcon
  fields: string[]
}

export const STEPS: StepDef[] = [
  {
    id: 'personal',
    title: 'About you',
    subtitle: 'Personal details & the personal law that governs your Will',
    Component: PersonalStep,
    Icon: UserCircle2,
    fields: ['personal'],
  },
  {
    id: 'revocation',
    title: 'Capacity & revocation',
    subtitle: 'Prior Wills and your declaration of sound mind',
    Component: RevocationStep,
    Icon: ShieldCheck,
    fields: ['revocation'],
  },
  {
    id: 'executors',
    title: 'Executors & guardians',
    subtitle: 'Who administers your estate, and who raises your children',
    Component: ExecutorsGuardiansStep,
    Icon: Users,
    fields: ['executorsGuardians'],
  },
  {
    id: 'assets',
    title: 'Assets & liabilities',
    subtitle: 'Everything you own, and what you owe against it',
    Component: AssetsStep,
    Icon: Banknote,
    fields: ['assets'],
  },
  {
    id: 'insurance',
    title: 'Life insurance',
    subtitle: 'Nominees and how they relate to your beneficiaries',
    Component: InsuranceStep,
    Icon: ShieldCheck,
    fields: ['insurance'],
  },
  {
    id: 'distribution',
    title: 'Distribution',
    subtitle: 'Who gets what, and who steps in if they cannot',
    Component: DistributionStep,
    Icon: PieChart,
    fields: ['distribution'],
  },
  {
    id: 'funeral',
    title: 'Funeral & expenses',
    subtitle: 'Final wishes and estate settlement order',
    Component: FuneralStep,
    Icon: Flower2,
    fields: ['funeral'],
  },
  {
    id: 'execution',
    title: 'Execution & witnesses',
    subtitle: 'What has to happen on paper, in person',
    Component: ExecutionStep,
    Icon: FileSignature,
    fields: ['execution'],
  },
  {
    id: 'documents',
    title: 'Document Vault',
    subtitle: 'Upload, classify, and reconcile supporting document metadata',
    Component: DocumentVaultStep,
    Icon: FileSignature,
    fields: ['documentVault'],
  },
  {
    id: 'estate-os',
    title: 'Estate OS',
    subtitle: 'Copilot, scenarios, reviews, execution workflows, and legacy vault',
    Component: EstateOsStep,
    Icon: LayoutDashboard,
    fields: ['estateOs'],
  },
  {
    id: 'estate-profile',
    title: 'Estate Profile',
    subtitle: 'Structured estate summary, gaps, and execution readiness',
    Component: EstateProfileStep,
    Icon: LayoutDashboard,
    fields: [],
  },
  {
    id: 'review',
    title: 'Review',
    subtitle: 'Legal flags and your draft document',
    Component: ReviewStep,
    Icon: ScrollText,
    fields: [],
  },
  {
    id: 'consultation',
    title: 'Talk to a lawyer',
    subtitle: 'Hand your flagged items to a qualified reviewer',
    Component: ConsultationStep,
    Icon: MessageCircleHeart,
    fields: [],
  },
]
