import { newId } from '../../lib/id'
import { Controller, useFieldArray, useFormContext } from 'react-hook-form'
import type { WillData } from '../../lib/types'
import { Callout, Card, Field, RemoveButton, RepeaterHeader, SelectInput, TextInput, YesNoToggle } from '../fields'

export function InsuranceStep() {
  const { control, register, watch } = useFormContext<WillData>()
  const policies = useFieldArray({ control, name: 'insurance.policies' })
  const hasPolicies = watch('insurance.hasPolicies')

  return (
    <div className="space-y-5">
      <Field label="Do you hold any life insurance policies?">
        <Controller
          control={control}
          name="insurance.hasPolicies"
          render={({ field }) => <YesNoToggle value={field.value} onChange={field.onChange} />}
        />
      </Field>

      {hasPolicies && (
        <>
          <Callout tone="info" title="Nominee vs. beneficiary">
            Under Section 39 of the Insurance Act, a nominee who is your spouse, parent, or child is
            treated as the <strong>beneficial owner</strong> of the payout by default — your Will may not
            override that. Any other nominee (sibling, friend) generally holds the payout only as a{' '}
            <strong>trustee</strong> for your legal heirs.
          </Callout>

          <RepeaterHeader
            title="Policies"
            onAdd={() =>
              policies.append({
                id: newId(),
                insurer: '',
                policyNumber: '',
                nomineeName: '',
                nomineeRelationship: '',
                alignWithWill: null,
              })
            }
          />
          {policies.fields.map((f, i) => (
            <Card key={f.id}>
              <div className="mb-2 flex justify-end">
                <RemoveButton onClick={() => policies.remove(i)} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Insurer">
                  <TextInput {...register(`insurance.policies.${i}.insurer`)} />
                </Field>
                <Field label="Policy number">
                  <TextInput {...register(`insurance.policies.${i}.policyNumber`)} />
                </Field>
                <Field label="Nominee name">
                  <TextInput {...register(`insurance.policies.${i}.nomineeName`)} />
                </Field>
                <Field label="Nominee's relationship to you">
                  <Controller
                    control={control}
                    name={`insurance.policies.${i}.nomineeRelationship`}
                    render={({ field }) => (
                      <SelectInput {...field}>
                        <option value="">Select</option>
                        <option value="spouse">Spouse</option>
                        <option value="parent">Parent</option>
                        <option value="child">Child</option>
                        <option value="other">Other (sibling, friend, etc.)</option>
                      </SelectInput>
                    )}
                  />
                </Field>
              </div>
              <div className="mt-3">
                <Field label="Is this nominee also the ultimate intended beneficiary of the proceeds under this Will?">
                  <Controller
                    control={control}
                    name={`insurance.policies.${i}.alignWithWill`}
                    render={({ field }) => <YesNoToggle value={field.value} onChange={field.onChange} />}
                  />
                </Field>
              </div>
            </Card>
          ))}
        </>
      )}
    </div>
  )
}
