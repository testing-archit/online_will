import { Controller, useFieldArray, useFormContext } from 'react-hook-form'
import { emptyPerson } from '../../lib/defaultData'
import { newId } from '../../lib/id'
import type { WillData } from '../../lib/types'
import { Card, Field, RemoveButton, RepeaterHeader, SelectInput, TextInput, YesNoToggle } from '../fields'

export function ExecutorsGuardiansStep() {
  const { control, register, watch } = useFormContext<WillData>()
  const executors = useFieldArray({ control, name: 'executorsGuardians.executors' })
  const guardians = useFieldArray({ control, name: 'executorsGuardians.guardians' })
  const children = useFieldArray({ control, name: 'executorsGuardians.children' })
  const hasChildren = watch('executorsGuardians.hasChildren')
  const hasMinorChildren = watch('executorsGuardians.hasMinorChildren')

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <RepeaterHeader
          title="Executors"
          onAdd={() => executors.append({ ...emptyPerson(), isAlternate: executors.fields.length > 0 })}
        />
        <p className="text-xs text-slate-500">
          Your executor administers the estate, pays debts, and distributes assets. Name at least one
          primary executor; an alternate is recommended in case the first is unable or unwilling to act.
        </p>
        {executors.fields.map((f, i) => (
          <Card key={f.id}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-brand-primary">
                {watch(`executorsGuardians.executors.${i}.isAlternate`) ? 'Alternate executor' : 'Primary executor'}
              </span>
              {executors.fields.length > 1 && <RemoveButton onClick={() => executors.remove(i)} />}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Full name">
                <TextInput {...register(`executorsGuardians.executors.${i}.fullName`)} />
              </Field>
              <Field label="Relationship to you">
                <TextInput {...register(`executorsGuardians.executors.${i}.relationship`)} />
              </Field>
              <Field label="Age">
                <TextInput {...register(`executorsGuardians.executors.${i}.age`)} />
              </Field>
              <Field label="Address">
                <TextInput {...register(`executorsGuardians.executors.${i}.address`)} />
              </Field>
            </div>
          </Card>
        ))}
      </section>

      <Field label="Should your executor(s) be compensated from the estate for their services?">
        <Controller
          control={control}
          name="executorsGuardians.compensation"
          render={({ field }) => (
            <SelectInput {...field}>
              <option value="">Select</option>
              <option value="compensated">Yes, compensate from estate</option>
              <option value="uncompensated">No, they serve without remuneration</option>
            </SelectInput>
          )}
        />
      </Field>

      <section className="space-y-3 border-t border-slate-200 pt-6">
        <Field label="Do you have children?">
          <Controller
            control={control}
            name="executorsGuardians.hasChildren"
            render={({ field }) => <YesNoToggle value={field.value} onChange={field.onChange} />}
          />
        </Field>

        {hasChildren && (
          <div className="space-y-3">
            <RepeaterHeader
              title="Your children"
              addLabel="Add a child"
              onAdd={() => children.append({ id: newId(), fullName: '', age: '' })}
            />
            <p className="text-xs text-slate-500">
              Optional, but naming each child lets us check that every child is provided for in your distribution.
            </p>
            {children.fields.map((f, i) => (
              <Card key={f.id}>
                <div className="mb-2 flex justify-end">
                  <RemoveButton onClick={() => children.remove(i)} />
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
                  <Field label="Full name">
                    <TextInput {...register(`executorsGuardians.children.${i}.fullName`)} />
                  </Field>
                  <Field label="Age">
                    <TextInput {...register(`executorsGuardians.children.${i}.age`)} inputMode="numeric" />
                  </Field>
                </div>
              </Card>
            ))}
          </div>
        )}

        {hasChildren && (
          <Field label="Are any of your children minors?">
            <Controller
              control={control}
            name="executorsGuardians.hasMinorChildren"
              render={({ field }) => <YesNoToggle value={field.value} onChange={field.onChange} />}
            />
          </Field>
        )}

        {hasChildren && hasMinorChildren && (
          <>
            <RepeaterHeader
              title="Guardians"
              onAdd={() => guardians.append({ ...emptyPerson(), isAlternate: guardians.fields.length > 0, financialInstructions: '' })}
            />
            {guardians.fields.length === 0 && (
              <p className="text-xs text-rose-600">Add at least one primary guardian for your minor children.</p>
            )}
            {guardians.fields.map((f, i) => (
              <Card key={f.id}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-brand-primary">
                    {watch(`executorsGuardians.guardians.${i}.isAlternate`) ? 'Alternate guardian' : 'Primary guardian'}
                  </span>
                  <RemoveButton onClick={() => guardians.remove(i)} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Full name">
                    <TextInput {...register(`executorsGuardians.guardians.${i}.fullName`)} />
                  </Field>
                  <Field label="Relationship to child(ren)">
                    <TextInput {...register(`executorsGuardians.guardians.${i}.relationship`)} />
                  </Field>
                  <Field label="Age">
                    <TextInput {...register(`executorsGuardians.guardians.${i}.age`)} />
                  </Field>
                  <Field label="Address">
                    <TextInput {...register(`executorsGuardians.guardians.${i}.address`)} />
                  </Field>
                </div>
                <div className="mt-3">
                  <Field
                    label="Financial instructions for this guardian"
                    hint="Restrict or direct how funds (trusts, FDs, etc.) are released for the child's upkeep, education, or healthcare."
                  >
                    <TextInput {...register(`executorsGuardians.guardians.${i}.financialInstructions`)} />
                  </Field>
                </div>
              </Card>
            ))}
          </>
        )}
      </section>
    </div>
  )
}
