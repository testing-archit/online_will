import { Controller, useFieldArray, useFormContext } from 'react-hook-form'
import { listAssets, type AssetRef } from '../../lib/assetMapping'
import { newId } from '../../lib/id'
import type { WillData } from '../../lib/types'
import { Callout, Card, Field, RemoveButton, RepeaterHeader, SelectInput, TextArea, TextInput, YesNoToggle } from '../fields'

export function DistributionStep() {
  const { control, register, watch } = useFormContext<WillData>()
  const beneficiaries = useFieldArray({ control, name: 'distribution.beneficiaries' })
  const scheme = watch('distribution.scheme')
  const religion = watch('personal.religion')
  const hasFutureAssets = watch('distribution.hasFutureAssets')
  const assets = listAssets(watch())
  const beneficiaryValues = watch('distribution.beneficiaries') ?? []
  const percentTotal = beneficiaryValues.reduce((sum, item) => sum + (Number.parseFloat(item.share?.match(/(\d+(?:\.\d+)?)\s*%/)?.[1] ?? '') || 0), 0)

  return (
    <div className="space-y-5">
      <Field label="How do you want to distribute your assets?">
        <Controller
          control={control}
          name="distribution.scheme"
          render={({ field }) => (
            <SelectInput {...field}>
              <option value="">Select a scheme</option>
              <option value="all-in-one">All-in-one — 100% to a single primary beneficiary</option>
              <option value="itemized">Itemized — specific assets to specific individuals</option>
              <option value="percentage">Percentage / share-based residue split</option>
            </SelectInput>
          )}
        />
      </Field>

      {scheme && (
        <>
          <RepeaterHeader
            title="Beneficiaries"
            onAdd={() =>
              beneficiaries.append({
                id: newId(),
                name: '',
                relationship: '',
                share: '',
                substituteBeneficiary: '',
                assignedAssetIds: [],
              })
            }
          />
          {religion === 'muslim' && (
            <Callout tone="info" title="Shariat 1/3rd rule">
              Shares assigned to beneficiaries marked "Other" (non-heirs) beyond a combined 1/3rd of
              the estate need consent from your other legal heirs to be valid.
            </Callout>
          )}
          {beneficiaries.fields.map((f, i) => (
            <Card key={f.id}>
              <div className="mb-2 flex justify-end">
                <RemoveButton onClick={() => beneficiaries.remove(i)} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name">
                  <TextInput {...register(`distribution.beneficiaries.${i}.name`)} />
                </Field>
                <Field label="Relationship to you">
                  <Controller
                    control={control}
                    name={`distribution.beneficiaries.${i}.relationship`}
                    render={({ field }) => (
                      <SelectInput {...field}>
                        <option value="">Select</option>
                        <option value="spouse">Spouse</option>
                        <option value="child">Child</option>
                        <option value="parent">Parent</option>
                        <option value="other">Other (non-heir)</option>
                      </SelectInput>
                    )}
                  />
                </Field>
                <Field
                  label={scheme === 'itemized' ? 'Description of the gift (optional)' : 'Share'}
                  hint={
                    scheme === 'percentage'
                      ? 'Enter as a percentage, e.g. "25%"'
                      : scheme === 'itemized'
                        ? 'Use "residue" for whoever takes everything not gifted specifically.'
                        : undefined
                  }
                >
                  <TextInput {...register(`distribution.beneficiaries.${i}.share`)} />
                </Field>
                <Field label="If this beneficiary predeceases you, who inherits instead?">
                  <TextInput {...register(`distribution.beneficiaries.${i}.substituteBeneficiary`)} />
                </Field>
              </div>
              {scheme === 'itemized' && (
                <div className="mt-3">
                  <p className="mb-2 text-[13px] font-medium tracking-wide text-slate-800">Assets this person receives</p>
                  <Controller
                    control={control}
                    name={`distribution.beneficiaries.${i}.assignedAssetIds`}
                    render={({ field }) => (
                      <AssetPicker
                        assets={assets}
                        value={field.value ?? []}
                        onChange={field.onChange}
                        assignedElsewhere={assignedElsewhere(beneficiaryValues, i)}
                      />
                    )}
                  />
                </div>
              )}
            </Card>
          ))}
          {scheme === 'percentage' && beneficiaries.fields.length > 0 && (
            <div
              className={`rounded-xl border px-3 py-2 text-sm ${
                Math.abs(percentTotal - 100) < 0.01 ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'
              }`}
              role="status"
            >
              Shares total {Number.parseFloat(percentTotal.toFixed(2))}%
              {Math.abs(percentTotal - 100) < 0.01 ? ' — accounts for the whole residue.' : ' — they should add up to 100%.'}
            </div>
          )}
        </>
      )}

      <section className="space-y-3 border-t border-slate-200 pt-6">
        <Field label="Are you expecting to inherit any assets in the future (e.g. from a parent's estate)?">
          <Controller
            control={control}
            name="distribution.hasFutureAssets"
            render={({ field }) => <YesNoToggle value={field.value} onChange={field.onChange} />}
          />
        </Field>
        {hasFutureAssets && (
          <Field label="Instructions for the Executor if such assets vest in your estate">
            <TextArea {...register('distribution.futureAssetInstructions')} />
          </Field>
        )}
      </section>

      <section className="space-y-3 border-t border-slate-200 pt-6">
        <h3 className="text-sm font-semibold text-slate-800">Survivorship & contingency</h3>
        <Field
          label="Include a simultaneous-death clause?"
          hint="Covers the case where you and a beneficiary die together, or in circumstances where it's unclear who survived whom."
        >
          <Controller
            control={control}
            name="distribution.wantsSimultaneousDeathClause"
            render={({ field }) => <YesNoToggle value={field.value} onChange={field.onChange} />}
          />
        </Field>
        <Field
          label="Ultimate (residuary) beneficiary"
          hint="If every beneficiary and substitute named above predeceases you, who or what should receive the residue — a relative, or a charitable institution?"
        >
          <TextInput {...register('distribution.residuaryBeneficiary')} placeholder="e.g. XYZ Charitable Trust" />
        </Field>
      </section>
    </div>
  )
}

function assignedElsewhere(beneficiaries: WillData['distribution']['beneficiaries'], index: number) {
  const map = new Map<string, string>()
  beneficiaries.forEach((beneficiary, position) => {
    if (position === index) return
    for (const id of beneficiary.assignedAssetIds ?? []) map.set(id, beneficiary.name || 'another beneficiary')
  })
  return map
}

function AssetPicker({
  assets,
  value,
  onChange,
  assignedElsewhere,
}: {
  assets: AssetRef[]
  value: string[]
  onChange: (next: string[]) => void
  assignedElsewhere: Map<string, string>
}) {
  if (assets.length === 0) {
    return <p className="text-xs text-slate-400">Add assets in the Assets step (or Life insurance) to assign them here.</p>
  }
  return (
    <div className="flex flex-wrap gap-2">
      {assets.map((asset) => {
        const selected = value.includes(asset.id)
        const other = assignedElsewhere.get(asset.id)
        return (
          <button
            key={asset.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(selected ? value.filter((id) => id !== asset.id) : [...value, asset.id])}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              selected ? 'border-brand-primary bg-brand-primary text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-brand-secondary'
            }`}
          >
            {asset.title}
            {other && !selected ? ` (also: ${other})` : ''}
          </button>
        )
      })}
    </div>
  )
}
