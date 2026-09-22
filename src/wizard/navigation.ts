import { createContext, useContext } from 'react'

/** Lets any step jump to another step by id (e.g. "edit" links on the answer review). */
export const WizardNavigationContext = createContext<{ goToStep: (stepId: string) => void }>({ goToStep: () => {} })

export function useWizardNavigation() {
  return useContext(WizardNavigationContext)
}
