import { describe, expect, it } from 'vitest'
import { defaultWillData, emptyPerson } from './defaultData'
import { newId } from './id'
import {
  describeAnswer,
  getAnswerReview,
  getMissingRequiredQuestions,
  getOverallCompletion,
  getPathValue,
  getSectionCompletion,
  getVisibleFieldPaths,
  getVisibleQuestions,
  hasRequiredQuestions,
  isQuestionAnswered,
  isQuestionVisible,
  QUESTIONNAIRE_QUESTIONS,
  type QuestionnaireQuestion,
} from './questionnaireSchema'

function questionFor(id: string): QuestionnaireQuestion {
  const question = QUESTIONNAIRE_QUESTIONS.find((item) => item.id === id)
  if (!question) throw new Error(`no such question: ${id}`)
  return question
}

describe('getPathValue', () => {
  it('resolves a dotted path', () => {
    const data = defaultWillData()
    data.personal.fullLegalName = 'Archit Mehta'
    expect(getPathValue(data, 'personal.fullLegalName')).toBe('Archit Mehta')
  })

  it('returns undefined for a missing key or a path through a non-object', () => {
    const data = defaultWillData()
    expect(getPathValue(data, 'personal.nonExistentField')).toBeUndefined()
    expect(getPathValue(data, 'personal.fullLegalName.nested')).toBeUndefined()
  })
})

describe('isQuestionVisible / dependsOn conditions', () => {
  it('equals: shows religionOther only when religion is "other"', () => {
    const data = defaultWillData()
    const religionOther = questionFor('personal.religionOther')
    expect(isQuestionVisible(religionOther, data)).toBe(false)
    data.personal.religion = 'other'
    expect(isQuestionVisible(religionOther, data)).toBe(true)
  })

  it('notEmpty: beneficiaries only appear once a distribution scheme is chosen', () => {
    const data = defaultWillData()
    const beneficiaries = questionFor('distribution.beneficiaries')
    expect(isQuestionVisible(beneficiaries, data)).toBe(false)
    data.distribution.scheme = 'all-in-one'
    expect(isQuestionVisible(beneficiaries, data)).toBe(true)
  })

  it('chained equals: guardians require both hasChildren and hasMinorChildren to be true', () => {
    const data = defaultWillData()
    const guardians = questionFor('executorsGuardians.guardians')
    expect(isQuestionVisible(guardians, data)).toBe(false)
    data.executorsGuardians.hasChildren = true
    expect(isQuestionVisible(guardians, data)).toBe(false) // hasMinorChildren still unset
    data.executorsGuardians.hasMinorChildren = true
    expect(isQuestionVisible(guardians, data)).toBe(true)
  })

  it('isTruthy and arrayMinLength conditions', () => {
    const data = defaultWillData()
    const isTruthyQuestion: QuestionnaireQuestion = { ...questionFor('personal.city'), dependsOn: [{ path: 'personal.hasChildren', operator: 'isTruthy' }] }
    expect(isQuestionVisible(isTruthyQuestion, data)).toBe(false)

    const arrayMinLengthQuestion: QuestionnaireQuestion = {
      ...questionFor('personal.city'),
      dependsOn: [{ path: 'executorsGuardians.executors', operator: 'arrayMinLength', min: 2 }],
    }
    expect(isQuestionVisible(arrayMinLengthQuestion, data)).toBe(false) // only 1 default executor
    data.executorsGuardians.executors.push({ ...emptyPerson(), isAlternate: true })
    expect(isQuestionVisible(arrayMinLengthQuestion, data)).toBe(true)
  })
})

describe('isQuestionAnswered: every completion rule', () => {
  it('not-empty requires a non-blank trimmed string', () => {
    const data = defaultWillData()
    const q = questionFor('personal.fullLegalName')
    expect(isQuestionAnswered(q, data)).toBe(false)
    data.personal.fullLegalName = '   '
    expect(isQuestionAnswered(q, data)).toBe(false)
    data.personal.fullLegalName = 'Archit Mehta'
    expect(isQuestionAnswered(q, data)).toBe(true)
  })

  it('boolean-answered accepts true or false, but not null', () => {
    const data = defaultWillData()
    const q = questionFor('revocation.hasPriorWills')
    expect(isQuestionAnswered(q, data)).toBe(false)
    data.revocation.hasPriorWills = false
    expect(isQuestionAnswered(q, data)).toBe(true)
    data.revocation.hasPriorWills = true
    expect(isQuestionAnswered(q, data)).toBe(true)
  })

  it('confirm-true requires exactly true, not just any truthy value', () => {
    const data = defaultWillData()
    const q = questionFor('revocation.soundMindDeclaration')
    expect(isQuestionAnswered(q, data)).toBe(false)
    data.revocation.soundMindDeclaration = true
    expect(isQuestionAnswered(q, data)).toBe(true)
  })

  it('array-min-one-complete requires at least one entry with a meaningful name/label field', () => {
    const data = defaultWillData()
    const q = questionFor('executorsGuardians.executors')
    data.executorsGuardians.executors = [{ ...emptyPerson(), fullName: '', isAlternate: false }]
    expect(isQuestionAnswered(q, data)).toBe(false)
    data.executorsGuardians.executors = [{ ...emptyPerson(), fullName: 'Ravi Mehta', isAlternate: false }]
    expect(isQuestionAnswered(q, data)).toBe(true)
  })

  it('adult-date requires a parseable date of birth 18 years or older', () => {
    const data = defaultWillData()
    const q = questionFor('personal.dateOfBirth')
    data.personal.dateOfBirth = 'not-a-date'
    expect(isQuestionAnswered(q, data)).toBe(false)
    data.personal.dateOfBirth = new Date().toISOString().slice(0, 10)
    expect(isQuestionAnswered(q, data)).toBe(false) // born today
    data.personal.dateOfBirth = '1990-01-01'
    expect(isQuestionAnswered(q, data)).toBe(true)
  })

  it('optional questions are always answered', () => {
    const q = questionFor('funeral.funeralWishes')
    expect(isQuestionAnswered(q, defaultWillData())).toBe(true)
  })
})

describe('getVisibleQuestions / getVisibleFieldPaths / hasRequiredQuestions', () => {
  it('hides conditional questions until their condition is met', () => {
    const paths = getVisibleFieldPaths(defaultWillData(), 'assets')
    expect(paths).not.toContain('assets.encumbranceDetails')
    expect(paths).not.toContain('assets.debtSettlementMethod')
  })

  it('reveals them once the condition is met', () => {
    const data = defaultWillData()
    data.assets.hasEncumberedAssets = true
    const paths = getVisibleFieldPaths(data, 'assets')
    expect(paths).toContain('assets.encumbranceDetails')
    expect(paths).toContain('assets.debtSettlementMethod')
  })

  it('a section has required questions by default', () => {
    expect(hasRequiredQuestions(defaultWillData(), 'personal')).toBe(true)
  })

  it('getVisibleQuestions can be scoped to one section or return everything', () => {
    const data = defaultWillData()
    expect(getVisibleQuestions(data, 'personal').every((q) => q.sectionId === 'personal')).toBe(true)
    expect(getVisibleQuestions(data).length).toBeGreaterThan(getVisibleQuestions(data, 'personal').length)
  })
})

describe('getSectionCompletion / getOverallCompletion / getMissingRequiredQuestions', () => {
  it('is 0% when nothing required is answered, and rises as required fields fill in', () => {
    const data = defaultWillData()
    expect(getSectionCompletion(data, 'revocation')).toBe(0)
    data.revocation.hasPriorWills = false
    data.revocation.soundMindDeclaration = true
    // 2 of 2 visible required questions now answered (revokesAllPrior stays hidden; hasMedicalCertificate is optional)
    expect(getSectionCompletion(data, 'revocation')).toBe(100)
  })

  it('lists exactly the required, visible, unanswered questions for a section', () => {
    const data = defaultWillData()
    const missingIds = getMissingRequiredQuestions(data, 'revocation').map((q) => q.id)
    expect(missingIds).toContain('revocation.hasPriorWills')
    expect(missingIds).toContain('revocation.soundMindDeclaration')
    expect(missingIds).not.toContain('revocation.revokesAllPrior') // hidden: hasPriorWills isn't true
    expect(missingIds).not.toContain('revocation.hasMedicalCertificate') // optional, not required
  })

  it('overall completion reflects every section, not just one', () => {
    const blank = getOverallCompletion(defaultWillData())
    const data = defaultWillData()
    data.personal.fullLegalName = 'Archit Mehta'
    expect(getOverallCompletion(data)).toBeGreaterThan(blank)
  })
})

describe('describeAnswer', () => {
  it('formats yes-no and checkbox answers', () => {
    const data = defaultWillData()
    data.revocation.hasPriorWills = true
    expect(describeAnswer(questionFor('revocation.hasPriorWills'), data)).toBe('Yes')
    data.revocation.hasPriorWills = false
    expect(describeAnswer(questionFor('revocation.hasPriorWills'), data)).toBe('No')
    data.execution.acknowledgesCodicilProcess = true
    expect(describeAnswer(questionFor('execution.acknowledgesCodicilProcess'), data)).toBe('Confirmed')
  })

  it('maps a select answer through its display-label table', () => {
    const data = defaultWillData()
    data.personal.religion = 'hindu'
    expect(describeAnswer(questionFor('personal.religion'), data)).toBe('Hindu')
    data.distribution.scheme = 'percentage'
    expect(describeAnswer(questionFor('distribution.scheme'), data)).toBe('Percentage / share-based')
  })

  it('summarizes each repeater kind in its own format', () => {
    const data = defaultWillData()
    data.executorsGuardians.executors = [
      { ...emptyPerson(), fullName: 'Ravi Mehta', isAlternate: false },
      { ...emptyPerson(), fullName: 'Backup Mehta', isAlternate: true },
    ]
    expect(describeAnswer(questionFor('executorsGuardians.executors'), data)).toBe('Ravi Mehta; Backup Mehta (alternate)')

    data.executorsGuardians.children = [{ id: newId(), fullName: 'Anaya', age: '10' }]
    expect(describeAnswer(questionFor('executorsGuardians.children'), data)).toBe('Anaya, 10')

    data.assets.bankAccounts = [{ id: newId(), bankName: 'HDFC', branch: 'Connaught Place', accountNumber: '123' }]
    expect(describeAnswer(questionFor('assets.bankAccounts'), data)).toBe('HDFC, Connaught Place')

    data.insurance.policies = [{ id: newId(), insurer: 'LIC', policyNumber: '1', nomineeName: 'Priya', nomineeRelationship: 'spouse', alignWithWill: true }]
    expect(describeAnswer(questionFor('insurance.policies'), data)).toBe('LIC — nominee Priya')

    data.distribution.scheme = 'percentage'
    data.distribution.beneficiaries = [{ id: newId(), name: 'Priya', relationship: 'spouse', share: '50%', substituteBeneficiary: '' }]
    expect(describeAnswer(questionFor('distribution.beneficiaries'), data)).toBe('Priya: 50%')

    data.execution.witnesses = [{ ...emptyPerson(), fullName: 'Witness One', isAlsoBeneficiary: false, idNumber: '' }]
    expect(describeAnswer(questionFor('execution.witnesses'), data)).toBe('Witness One')
  })

  it('falls back to plain text for text/date/textarea questions', () => {
    const data = defaultWillData()
    data.funeral.funeralWishes = 'Cremation, no elaborate ceremony.'
    expect(describeAnswer(questionFor('funeral.funeralWishes'), data)).toBe('Cremation, no elaborate ceremony.')
  })
})

describe('getAnswerReview', () => {
  it('excludes the review section itself, and includes every other section with visible rows', () => {
    const sections = getAnswerReview(defaultWillData())
    expect(sections.some((s) => s.sectionId === 'review')).toBe(false)
    expect(sections.every((s) => s.rows.length > 0)).toBe(true)
  })

  it('reports each row\'s answered state consistently with isQuestionAnswered', () => {
    const data = defaultWillData()
    data.personal.fullLegalName = 'Archit Mehta'
    const personalSection = getAnswerReview(data).find((s) => s.sectionId === 'personal')!
    const nameRow = personalSection.rows.find((r) => r.path === 'personal.fullLegalName')!
    expect(nameRow.answered).toBe(true)
    expect(nameRow.answer).toBe('Archit Mehta')
  })
})
