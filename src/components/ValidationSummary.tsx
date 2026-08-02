import type { FieldError } from '../domain/validation'

export function ValidationSummary({
  errors,
  warnings = [],
}: {
  errors: FieldError[]
  warnings?: FieldError[]
}) {
  if (!errors.length && !warnings.length) {
    return null
  }

  return (
    <div className="validation-summary" role="alert" aria-live="polite">
      {errors.length > 0 && (
        <>
          <strong>Please fix these details before saving.</strong>
          <ul>
            {errors.map((error, index) => (
              <li key={`${error.field}-${index}`}>{error.message}</li>
            ))}
          </ul>
        </>
      )}
      {warnings.length > 0 && (
        <>
          <strong>Review warning</strong>
          <ul>
            {warnings.map((warning, index) => (
              <li key={`${warning.field}-${index}`}>{warning.message}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

