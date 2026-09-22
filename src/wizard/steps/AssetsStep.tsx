import { newId } from '../../lib/id'
import { Controller, useFieldArray, useFormContext } from 'react-hook-form'
import type { WillData } from '../../lib/types'
import { Card, Field, RemoveButton, RepeaterHeader, SelectInput, TextInput, YesNoToggle } from '../fields'

export function AssetsStep() {
  const { control, register, watch } = useFormContext<WillData>()
  const immovable = useFieldArray({ control, name: 'assets.immovableAssets' })
  const banks = useFieldArray({ control, name: 'assets.bankAccounts' })
  const investments = useFieldArray({ control, name: 'assets.investments' })
  const valuables = useFieldArray({ control, name: 'assets.valuables' })
  const hasEncumbered = watch('assets.hasEncumberedAssets')

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <RepeaterHeader
          title="Immovable property"
          onAdd={() => immovable.append({ id: newId(), address: '', surveyNumber: '', registryDetails: '', ownershipShare: '' })}
        />
        {immovable.fields.map((f, i) => (
          <Card key={f.id}>
            <div className="mb-2 flex justify-end">
              <RemoveButton onClick={() => immovable.remove(i)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Address">
                <TextInput {...register(`assets.immovableAssets.${i}.address`)} />
              </Field>
              <Field label="Survey / khasra number">
                <TextInput {...register(`assets.immovableAssets.${i}.surveyNumber`)} />
              </Field>
              <Field label="Registry details">
                <TextInput {...register(`assets.immovableAssets.${i}.registryDetails`)} />
              </Field>
              <Field label="Your share of ownership">
                <TextInput {...register(`assets.immovableAssets.${i}.ownershipShare`)} placeholder="e.g. 100% / 50%" />
              </Field>
              <Field label="Approximate value (optional)" hint="e.g. ₹2.5 Cr — used for your estate summary and to check documents.">
                <TextInput {...register(`assets.immovableAssets.${i}.estimatedValue`)} placeholder="₹" />
              </Field>
            </div>
          </Card>
        ))}
      </section>

      <section className="space-y-3">
        <RepeaterHeader
          title="Bank accounts & fixed deposits"
          onAdd={() => banks.append({ id: newId(), bankName: '', branch: '', accountNumber: '' })}
        />
        {banks.fields.map((f, i) => (
          <Card key={f.id}>
            <div className="mb-2 flex justify-end">
              <RemoveButton onClick={() => banks.remove(i)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Bank name">
                <TextInput {...register(`assets.bankAccounts.${i}.bankName`)} />
              </Field>
              <Field label="Branch">
                <TextInput {...register(`assets.bankAccounts.${i}.branch`)} />
              </Field>
              <Field label="Account number">
                <TextInput {...register(`assets.bankAccounts.${i}.accountNumber`)} />
              </Field>
              <Field label="Approximate balance (optional)">
                <TextInput {...register(`assets.bankAccounts.${i}.estimatedValue`)} placeholder="₹" />
              </Field>
              <Field label="Nominee (if any)">
                <TextInput {...register(`assets.bankAccounts.${i}.nomineeName`)} />
              </Field>
            </div>
          </Card>
        ))}
      </section>

      <section className="space-y-3">
        <RepeaterHeader
          title="Investments"
          onAdd={() => investments.append({ id: newId(), type: '', identifier: '', description: '' })}
        />
        <p className="text-xs text-slate-500">Demat accounts, mutual funds, stocks, bonds, PPF, EPF, NPS, etc.</p>
        {investments.fields.map((f, i) => (
          <Card key={f.id}>
            <div className="mb-2 flex justify-end">
              <RemoveButton onClick={() => investments.remove(i)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Type">
                <TextInput {...register(`assets.investments.${i}.type`)} placeholder="e.g. Demat / Mutual Fund / PPF" />
              </Field>
              <Field label="Identifier">
                <TextInput {...register(`assets.investments.${i}.identifier`)} placeholder="Account / folio number" />
              </Field>
              <Field label="Description">
                <TextInput {...register(`assets.investments.${i}.description`)} />
              </Field>
              <Field label="Approximate value (optional)">
                <TextInput {...register(`assets.investments.${i}.estimatedValue`)} placeholder="₹" />
              </Field>
              <Field label="Nominee (if any)">
                <TextInput {...register(`assets.investments.${i}.nomineeName`)} />
              </Field>
            </div>
          </Card>
        ))}
      </section>

      <section className="space-y-3">
        <RepeaterHeader
          title="Valuables"
          onAdd={() => valuables.append({ id: newId(), description: '', estimatedValue: '' })}
        />
        <p className="text-xs text-slate-500">Jewellery, artwork, vehicles, collectibles.</p>
        {valuables.fields.map((f, i) => (
          <Card key={f.id}>
            <div className="mb-2 flex justify-end">
              <RemoveButton onClick={() => valuables.remove(i)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Description / identifier">
                <TextInput {...register(`assets.valuables.${i}.description`)} />
              </Field>
              <Field label="Estimated value (optional)">
                <TextInput {...register(`assets.valuables.${i}.estimatedValue`)} />
              </Field>
            </div>
          </Card>
        ))}
      </section>

      <section className="space-y-3 border-t border-slate-200 pt-6">
        <Field label="Are any of your assets subject to mortgages, loans, or pledges?">
          <Controller
            control={control}
            name="assets.hasEncumberedAssets"
            render={({ field }) => <YesNoToggle value={field.value} onChange={field.onChange} />}
          />
        </Field>
        {hasEncumbered && (
          <>
            <Field label="Encumbrance details">
              <TextInput {...register('assets.encumbranceDetails')} placeholder="Which asset(s), lender, outstanding amount" />
            </Field>
            <Field label="How should these liabilities be settled?">
              <Controller
                control={control}
                name="assets.debtSettlementMethod"
                render={({ field }) => (
                  <SelectInput {...field}>
                    <option value="">Select</option>
                    <option value="specific-asset">From the specific encumbered asset itself</option>
                    <option value="estate-reserves">From general estate cash reserves</option>
                    <option value="before-distribution">Prior to any distribution to beneficiaries</option>
                  </SelectInput>
                )}
              />
            </Field>
          </>
        )}
      </section>
    </div>
  )
}
