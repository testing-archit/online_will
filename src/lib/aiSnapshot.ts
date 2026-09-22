import { computeAge } from './age'
import { maskIdentifier } from './assetMapping'
import type { WillData } from './types'

/**
 * What is sent to the AI provider. This is deliberately a *redacted subset* of
 * the Will: no date of birth (age only), no witness ID numbers, masked account
 * and policy numbers, and none of the internal history (audit trail, chat
 * logs). Third-party model calls should only ever see what they need.
 */
export function toAiSnapshot(data: WillData) {
  return {
    personal: {
      fullLegalName: data.personal.fullLegalName,
      state: data.personal.state,
      religion: data.personal.religion,
      age: computeAge(data.personal.dateOfBirth),
    },
    revocation: data.revocation,
    executorsGuardians: {
      hasChildren: data.executorsGuardians.hasChildren,
      hasMinorChildren: data.executorsGuardians.hasMinorChildren,
      children: data.executorsGuardians.children,
      executors: data.executorsGuardians.executors.map(({ fullName, relationship, isAlternate }) => ({ fullName, relationship, isAlternate })),
      guardians: data.executorsGuardians.guardians.map(({ fullName, relationship, isAlternate }) => ({ fullName, relationship, isAlternate })),
      compensation: data.executorsGuardians.compensation,
    },
    assets: {
      immovableAssets: data.assets.immovableAssets,
      bankAccounts: data.assets.bankAccounts.map((account) => ({ ...account, accountNumber: maskIdentifier(account.accountNumber) })),
      investments: data.assets.investments.map((investment) => ({ ...investment, identifier: maskIdentifier(investment.identifier) })),
      valuables: data.assets.valuables,
      hasEncumberedAssets: data.assets.hasEncumberedAssets,
      encumbranceDetails: data.assets.encumbranceDetails,
      debtSettlementMethod: data.assets.debtSettlementMethod,
    },
    insurance: {
      hasPolicies: data.insurance.hasPolicies,
      policies: data.insurance.policies.map((policy) => ({ ...policy, policyNumber: maskIdentifier(policy.policyNumber) })),
    },
    distribution: data.distribution,
    execution: {
      witnesses: data.execution.witnesses.map(({ fullName, isAlsoBeneficiary }) => ({ fullName, isAlsoBeneficiary })),
      plansVideoRecording: data.execution.plansVideoRecording,
      isUttarakhandExecution: data.execution.isUttarakhandExecution,
    },
    documentVault: {
      documents: data.documentVault.documents.map(({ id, fileName, category, status, extractedMetadata, reconciliationNotes }) => ({
        id,
        fileName,
        category,
        status,
        extractedMetadata,
        reconciliationNotes,
      })),
    },
  }
}

export type AiSnapshot = ReturnType<typeof toAiSnapshot>
