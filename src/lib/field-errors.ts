import type { Dispatch, SetStateAction } from 'react'

export type FieldErrorMap<TField extends string = string> = Partial<Record<TField, string>>

export function getFirstFieldError<TField extends string>(errors: FieldErrorMap<TField>) {
  return Object.entries(errors).find(([, message]) => Boolean(message))?.[0] as TField | undefined
}

export function focusFirstFieldError<TField extends string>(errors: FieldErrorMap<TField>) {
  const field = getFirstFieldError(errors)
  if (!field || typeof document === 'undefined') return

  window.requestAnimationFrame(() => {
    const target = document.getElementById(field)
      ?? document.querySelector<HTMLElement>(`[data-field-target="${field}"]`)
    if (!target) return

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center', inline: 'nearest' })
    const focusTarget = target.matches('input, textarea, select, button, [tabindex]')
      ? target
      : target.querySelector<HTMLElement>('input, textarea, select, button, [tabindex]')
    focusTarget?.focus({ preventScroll: true })
  })
}

export function clearFieldError<TField extends string>(
  setter: Dispatch<SetStateAction<FieldErrorMap<TField>>>,
  field: TField,
) {
  setter((current) => {
    if (!current[field]) return current
    const next = { ...current }
    delete next[field]
    return next
  })
}
