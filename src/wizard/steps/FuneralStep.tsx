import { Controller, useFormContext } from 'react-hook-form'
import type { WillData } from '../../lib/types'
import { Field, TextArea, YesNoToggle } from '../fields'

export function FuneralStep() {
  const { control, register } = useFormContext<WillData>()

  return (
    <div className="space-y-5">
      <Field label="Funeral & final rites wishes (optional)" hint="Cremation/burial preferences, ceremonies, or other requests.">
        <TextArea {...register('funeral.funeralWishes')} rows={4} />
      </Field>

      <Field label="Should funeral costs, administrative expenses, and outstanding debts be paid from your estate before distribution?">
        <Controller
          control={control}
          name="funeral.payExpensesFromEstate"
          render={({ field }) => <YesNoToggle value={field.value} onChange={field.onChange} />}
        />
      </Field>
    </div>
  )
}
