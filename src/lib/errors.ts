export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === 'string' && error) {
    return error
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const message = error.message
    if (typeof message === 'string' && message) {
      return message
    }
  }

  if (error !== null && error !== undefined) {
    const text = String(error)
    if (text && text !== '[object Object]') {
      return text
    }
  }

  return fallback
}
