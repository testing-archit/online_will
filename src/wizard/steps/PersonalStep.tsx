import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Controller, useFormContext } from 'react-hook-form'
import { computeAge } from '../../lib/age'
import { isCompletePincode, lookupPincode } from '../../lib/pincode'
import type { WillData } from '../../lib/types'
import { Callout, Field, SelectInput, TextInput } from '../fields'

const RELIGIONS: { value: WillData['personal']['religion']; label: string }[] = [
  { value: 'hindu', label: 'Hindu' },
  { value: 'muslim', label: 'Muslim' },
  { value: 'christian', label: 'Christian' },
  { value: 'parsi', label: 'Parsi' },
  { value: 'sikh', label: 'Sikh' },
  { value: 'jain', label: 'Jain' },
  { value: 'buddhist', label: 'Buddhist' },
  { value: 'other', label: 'Other' },
]

type LookupStatus = 'idle' | 'loading' | 'success' | 'error'

export function PersonalStep() {
  const {
    register,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useFormContext<WillData>()
  const religion = watch('personal.religion')
  const pincode = watch('personal.pincode')
  const dateOfBirth = watch('personal.dateOfBirth')
  const age = computeAge(dateOfBirth)
  // Lookup outcome is remembered per PIN; the visible status is derived during render
  // (no synchronous setState inside the effect).
  const [lookup, setLookup] = useState<{ pin: string; status: 'success' | 'error' } | null>(null)
  const pinIsComplete = isCompletePincode(pincode ?? '')
  const lookupStatus: LookupStatus = !pinIsComplete ? 'idle' : lookup?.pin === pincode ? lookup.status : 'loading'

  useEffect(() => {
    if (!pinIsComplete) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const result = await lookupPincode(pincode, controller.signal)
        if (controller.signal.aborted) return
        if (result) {
          setValue('personal.city', result.city, { shouldDirty: true })
          setValue('personal.state', result.state, { shouldDirty: true })
          setLookup({ pin: pincode, status: 'success' })
        } else {
          setLookup({ pin: pincode, status: 'error' })
        }
      } catch {
        if (!controller.signal.aborted) setLookup({ pin: pincode, status: 'error' })
      }
    }, 400)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [pincode, pinIsComplete, setValue])

  const dobError =
    dateOfBirth && age === null
      ? 'This date of birth is in the future or not valid.'
      : age !== null && age < 18
        ? 'A person must be at least 18 years old to make a Will.'
        : undefined

  return (
    <div className="space-y-5">
      <Field label="Full legal name" hint="Exactly as it appears on government-issued ID (Aadhaar/PAN).">
        <TextInput
          {...register('personal.fullLegalName', { required: 'Required' })}
          placeholder="e.g. Vaibhav Jain"
        />
        {errors.personal?.fullLegalName && (
          <p className="mt-1 text-xs text-rose-600">{errors.personal.fullLegalName.message}</p>
        )}
      </Field>

      <Field label="Date of birth" hint={age !== null && !dobError ? `You are currently ${age} years old.` : undefined} error={dobError}>
        <TextInput
          type="date"
          max={new Date().toISOString().slice(0, 10)}
          min="1900-01-01"
          aria-invalid={dobError ? true : undefined}
          {...register('personal.dateOfBirth', { required: true })}
        />
      </Field>

      <Field label="Address line" hint="House / flat number, street, locality.">
        <TextInput {...register('personal.addressLine', { required: true })} placeholder="e.g. 14B, Sunview Apartments, MG Road" />
      </Field>

      <p className="text-xs text-slate-500">Enter your PIN code and we'll fetch the city & state — both stay editable.</p>
      <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
        <Field label="PIN code">
          <div className="relative">
            <TextInput
              {...register('personal.pincode', {
                required: true,
                pattern: { value: /^[1-9][0-9]{5}$/, message: 'Enter a valid 6-digit PIN' },
              })}
              inputMode="numeric"
              maxLength={6}
              placeholder="e.g. 122001"
            />
            {lookupStatus === 'loading' && (
              <Loader2 className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
            )}
            {lookupStatus === 'success' && (
              <CheckCircle2 className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-emerald-500" />
            )}
            {lookupStatus === 'error' && (
              <AlertCircle className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-amber-500" />
            )}
          </div>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="City">
            <TextInput {...register('personal.city', { required: true })} placeholder="Auto-filled from PIN" />
          </Field>
          <Field label="State">
            <TextInput {...register('personal.state', { required: true })} placeholder="Auto-filled from PIN" />
          </Field>
        </div>
      </div>

      {lookupStatus === 'success' && (
        <p className="-mt-2 text-xs text-emerald-600">City & state auto-filled from your PIN code — edit them if needed.</p>
      )}
      {lookupStatus === 'error' && (
        <p className="-mt-2 text-xs text-amber-600">Couldn't look up that PIN code — please enter city & state manually.</p>
      )}

      <Field
        label="Religious affiliation"
        hint="Personal law determines what you can bequeath and to whom — this changes the legal checks we run for you."
      >
        <Controller
          control={control}
          name="personal.religion"
          rules={{ required: true }}
          render={({ field }) => (
            <SelectInput {...field}>
              <option value="">Select religion</option>
              {RELIGIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </SelectInput>
          )}
        />
      </Field>

      {religion === 'other' && (
        <Field label="Please specify your religion" hint="The applicable personal law depends on this — your lawyer will confirm which rules apply.">
          <TextInput {...register('personal.religionOther', { required: true })} placeholder="e.g. Jewish, Bahá'í, no religion" />
        </Field>
      )}

      {religion === 'muslim' && (
        <Callout tone="info" title="Islamic personal law (Shariat) applies">
          You can generally bequeath up to 1/3rd of your net estate to non-heirs without consent.
          Bequests beyond that to non-heirs, or bequests to legal heirs, require the consent of your
          other legal heirs. We'll flag this again when you set up distribution.
        </Callout>
      )}
      {(religion === 'christian' || religion === 'parsi') && (
        <Callout tone="warning" title="Witness rule to keep in mind">
          Under Section 67 of the Indian Succession Act, a bequest to a person who also acts as an
          attesting witness (or their spouse) is void for Christian and Parsi testators. Plan to use
          witnesses who don't inherit anything under this Will.
        </Callout>
      )}
    </div>
  )
}
