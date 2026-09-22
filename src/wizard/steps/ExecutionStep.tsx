import { MapPin } from 'lucide-react'
import { Controller, useFormContext } from 'react-hook-form'
import { jurisdictionSummary } from '../../lib/jurisdictionRules'
import type { WillData } from '../../lib/types'
import { Callout, Card, Field, TextInput, YesNoToggle } from '../fields'

export function ExecutionStep() {
  const { control, register, watch } = useFormContext<WillData>()
  const data = watch()
  const religion = data.personal.religion
  const state = data.personal.state
  const jurisdiction = jurisdictionSummary(data)

  return (
    <div className="space-y-6">
      <Callout tone="info" title="Two witnesses, present together, in person">
        Section 63 of the Indian Succession Act requires your signature to be made or acknowledged in
        the presence of two witnesses present at the same time, who then each sign in your presence.
        This step cannot be completed digitally — it happens on the printed document.
      </Callout>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-800">Attesting witnesses</h3>
        {[0, 1].map((i) => (
          <Card key={i}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-primary">Witness {i + 1}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Full name">
                <TextInput {...register(`execution.witnesses.${i}.fullName`)} />
              </Field>
              <Field label="Address">
                <TextInput {...register(`execution.witnesses.${i}.address`)} />
              </Field>
              <Field label="Relationship to you" hint="If any — helps flag overlap with your beneficiaries.">
                <TextInput {...register(`execution.witnesses.${i}.relationship`)} placeholder="e.g. Neighbour, colleague, none" />
              </Field>
              <Field label="ID number">
                <TextInput {...register(`execution.witnesses.${i}.idNumber`)} placeholder="Aadhaar / PAN / other ID" />
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Is this witness also a beneficiary under this Will?">
                <Controller
                  control={control}
                  name={`execution.witnesses.${i}.isAlsoBeneficiary`}
                  render={({ field }) => <YesNoToggle value={field.value} onChange={field.onChange} />}
                />
              </Field>
            </div>
          </Card>
        ))}
        {(religion === 'christian' || religion === 'parsi') && (
          <Callout tone="warning" title="Section 67 risk for Christian/Parsi testators">
            If a witness above is also a beneficiary, their bequest (or their spouse's) may be void.
            Consider substituting an independent witness who inherits nothing.
          </Callout>
        )}
      </section>

      <Field label="Do you plan to videotape the signing and reading-aloud of the Will?" hint="Optional — helps rebut future claims of incapacity or undue influence.">
        <Controller
          control={control}
          name="execution.plansVideoRecording"
          render={({ field }) => <YesNoToggle value={field.value} onChange={field.onChange} />}
        />
      </Field>

      <Field
        label="Will you be residing in or executing this Will in Uttarakhand?"
        hint={state?.toLowerCase().includes('uttarakhand') ? 'Based on your state above, this looks like it applies to you.' : undefined}
      >
        <Controller
          control={control}
          name="execution.isUttarakhandExecution"
          render={({ field }) => <YesNoToggle value={field.value} onChange={field.onChange} />}
        />
      </Field>

      <Card>
        <div className="mb-3 flex items-center gap-2">
          <MapPin className="h-4 w-4 text-brand-primary" />
          <h3 className="text-sm font-semibold text-slate-900">
            Jurisdiction rules — {jurisdiction.state}
          </h3>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Registration</p>
            <p className="mt-1 text-sm font-medium text-slate-800">
              {jurisdiction.registration === 'mandatory' ? 'Mandatory' : 'Optional (recommended)'}
            </p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Witnesses required</p>
            <p className="mt-1 text-sm font-medium text-slate-800">{jurisdiction.witnessesRequired} attesting witnesses</p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Video recording</p>
            <p className="mt-1 text-sm font-medium capitalize text-slate-800">{jurisdiction.videoRecording}</p>
          </div>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">{jurisdiction.registrationNote}</p>
        <p className="mt-1 text-xs text-slate-400">{jurisdiction.stampDutyNote}</p>
        <p className="mt-2 text-[11px] text-slate-400">Rules engine version {jurisdiction.version} — jurisdiction rules are versioned because legal requirements change over time.</p>
      </Card>

      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-1" {...register('execution.acknowledgesCodicilProcess')} />
        <span>
          I understand that future minor changes can be made through a simple, separately-attested
          Codicil rather than rewriting the entire Will.
        </span>
      </label>
    </div>
  )
}
