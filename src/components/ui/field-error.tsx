import type * as React from 'react'

import { cn } from '@/lib/utils'

interface FieldErrorProps extends React.ComponentProps<'p'> {
  field: string
  message?: string
}

export function FieldError({ field, message, className, ...props }: FieldErrorProps) {
  if (!message) return null

  return (
    <p
      id={`${field}-error`}
      role="alert"
      aria-live="polite"
      className={cn('text-sm text-destructive', className)}
      {...props}
    >
      {message}
    </p>
  )
}
