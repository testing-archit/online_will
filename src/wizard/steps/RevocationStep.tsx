import { Controller, useFormContext } from 'react-hook-form'
import type { WillData } from '../../lib/types'
import { Callout, Field, YesNoToggle } from '../fields'

export function RevocationStep() {
  const { control, watch } = useFormContext<WillData>()
  const hasPriorWills = watch('revocation.hasPriorWills')

  return (
    <div className="space-y-5">
      <Field label="Have you made any prior Will(s) or Codicil(s)?">
        <Controller
          control={control}
          name="revocation.hasPriorWills"
          render={({ field }) => <YesNoToggle value={field.value} onChange={field.onChange} />}
        />
      </Field>

      {hasPriorWills && (
        <>
          <Callout tone="warning" title="Revocation clause required">
            This new Will must explicitly revoke all earlier Wills and Codicils, otherwise a court may
            try to read both together and find conflicting bequests.
          </Callout>
          <Field label="Do you confirm this Will should revoke all previous Wills and Codicils?">
            <Controller
              control={control}
              name="revocation.revokesAllPrior"
              render={({ field }) => (
                <YesNoToggle value={field.value} onChange={field.onChange} />
              )}
            />
          </Field>
        </>
      )}

      <Field
        label="Sound mind, memory & free will declaration"
        hint="You must be able to declare you are of sound mind and acting voluntarily, without coercion, fraud, or undue influence."
      >
        <Controller
          control={control}
          name="revocation.soundMindDeclaration"
          render={({ field }) => (
            <YesNoToggle
              value={field.value}
              onChange={field.onChange}
              yesLabel="I confirm"
              noLabel="Not yet"
            />
          )}
        />
      </Field>

      <Field
        label="Do you have (or plan to obtain) a medical certificate of mental fitness at the time of execution?"
        hint="Optional, but strongly strengthens the Will against future incapacity challenges."
      >
        <Controller
          control={control}
          name="revocation.hasMedicalCertificate"
          render={({ field }) => <YesNoToggle value={field.value} onChange={field.onChange} />}
        />
      </Field>
    </div>
  )
}
