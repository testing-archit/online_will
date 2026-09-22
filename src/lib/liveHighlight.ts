import { QUESTIONNAIRE_QUESTIONS } from './questionnaireSchema'

/**
 * Makes the screen mirror the conversation: what she just filled in flashes, and the question being asked is outlined
 * and scrolled into view. The steps register their inputs with the form path as the input's `name`, so the element
 * for a path is found by that name; yes/no toggles carry no name, so those are found by the question's label.
 */

const FLASH = 'live-flash'
const FOCUS = 'live-focus'
const FLASH_MS = 2400

function q(name: string) {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(name) : name.replace(/"/g, '\\"')
}

function labelled(label: string): HTMLElement | null {
  for (const span of document.querySelectorAll<HTMLElement>('main label > span:first-child')) {
    if (span.textContent?.trim() === label) return span.closest('label')
  }
  return null
}

/** The element to light up for a form path: a field, a whole list entry ("a.b.2"), or a list ("a.b"). */
export function elementForPath(path: string): HTMLElement | null {
  const field = document.querySelector<HTMLElement>(`[name="${q(path)}"]`)
  if (field) return field.closest<HTMLElement>('label') ?? field
  // An entry or a list: the card that holds its inputs.
  const inside = document.querySelector<HTMLElement>(`[name^="${q(`${path}.`)}"]`)
  if (inside) return inside.closest<HTMLElement>('.card-shadow') ?? inside.closest<HTMLElement>('label') ?? inside
  const label = QUESTIONNAIRE_QUESTIONS.find((question) => question.path === path)?.label
  return label ? labelled(label) : null
}

function whenRendered(action: () => void) {
  // The form re-renders after a value is set; give React a frame or two before looking for the element.
  window.setTimeout(() => window.requestAnimationFrame(action), 60)
}

const timers = new WeakMap<HTMLElement, number>()

export function flashPaths(paths: string[]): void {
  whenRendered(() => {
    let first: HTMLElement | null = null
    for (const path of paths) {
      const element = elementForPath(path)
      if (!element) continue
      first ??= element
      element.classList.remove(FLASH)
      void element.offsetWidth // restart the animation
      element.classList.add(FLASH)
      window.clearTimeout(timers.get(element))
      timers.set(element, window.setTimeout(() => element.classList.remove(FLASH), FLASH_MS))
    }
    first?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  })
}

let focused: HTMLElement | null = null

export function clearFocus(): void {
  focused?.classList.remove(FOCUS)
  focused = null
}

/** Outline the question being asked (by form path, else by its label) and bring it into view. */
export function focusQuestion(target: { path?: string; label?: string } | null): void {
  clearFocus()
  if (!target) return
  whenRendered(() => {
    const element = (target.path ? elementForPath(target.path) : null) ?? (target.label ? labelled(target.label) : null)
    if (!element) return
    element.classList.add(FOCUS)
    focused = element
    element.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  })
}
