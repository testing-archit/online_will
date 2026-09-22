// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearFocus, elementForPath, flashPaths, focusQuestion } from './liveHighlight'
import { QUESTIONNAIRE_QUESTIONS } from './questionnaireSchema'

const PRIOR_WILL_LABEL = QUESTIONNAIRE_QUESTIONS.find((question) => question.path === 'revocation.hasPriorWills')!.label

beforeEach(() => {
  vi.useFakeTimers()
  Element.prototype.scrollIntoView = vi.fn()
  document.body.innerHTML = `
    <main>
      <label><span>Full legal name</span><input name="personal.fullLegalName" /></label>
      <div class="card-shadow" id="executor0"><label><span>Full name</span><input name="executorsGuardians.executors.0.fullName" /></label></div>
      <label id="prior"><span>${PRIOR_WILL_LABEL}</span><div><button type="button">Yes</button></div></label>
    </main>`
})
afterEach(() => {
  vi.useRealTimers()
  clearFocus()
})

describe('live highlighting', () => {
  it('finds a field by its form path, a list entry by the card that holds it, and a toggle by its question', () => {
    expect(elementForPath('personal.fullLegalName')?.tagName).toBe('LABEL')
    expect(elementForPath('executorsGuardians.executors.0')?.id).toBe('executor0')
    expect(elementForPath('executorsGuardians.executors')?.id).toBe('executor0')
    expect(elementForPath('revocation.hasPriorWills')?.id).toBe('prior')
    expect(elementForPath('nothing.here')).toBeNull()
  })

  it('flashes what changed, scrolls to it, and stops flashing on its own', () => {
    flashPaths(['personal.fullLegalName', 'executorsGuardians.executors.0'])
    vi.advanceTimersByTime(200)
    const label = document.querySelector('label')!
    expect(label.classList.contains('live-flash')).toBe(true)
    expect(document.getElementById('executor0')!.classList.contains('live-flash')).toBe(true)
    expect(label.scrollIntoView).toHaveBeenCalled()
    vi.advanceTimersByTime(3000)
    expect(label.classList.contains('live-flash')).toBe(false)
  })

  it('outlines the question being asked, moves the outline, and clears it', () => {
    focusQuestion({ path: 'personal.fullLegalName' })
    vi.advanceTimersByTime(200)
    expect(document.querySelector('label')!.classList.contains('live-focus')).toBe(true)

    focusQuestion({ label: PRIOR_WILL_LABEL })
    vi.advanceTimersByTime(200)
    expect(document.querySelector('label')!.classList.contains('live-focus')).toBe(false)
    expect(document.getElementById('prior')!.classList.contains('live-focus')).toBe(true)

    clearFocus()
    expect(document.getElementById('prior')!.classList.contains('live-focus')).toBe(false)
  })
})
