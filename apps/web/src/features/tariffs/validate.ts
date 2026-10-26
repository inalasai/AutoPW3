import { CreateTariffRequestSchema } from '@autopw3/shared';
import type { TariffProblem } from '@autopw3/shared';
import { validateTariff } from '@autopw3/domain';
import type { TariffFormState, ValidationSummary } from './types';
import { formStateToCreateRequest } from './windows';

/**
 * Validates the tariff form state using both structural schema checks
 * and the domain tariff engine (overlaps, gaps, ambiguous seasons/overrides).
 */
export function validateTariffForm(state: TariffFormState): ValidationSummary {
  const problems: TariffProblem[] = [];
  const fieldErrors: Record<string, string> = {};

  const payload = formStateToCreateRequest(state);

  // 1. Structural and field-level validation via Zod schema
  const schemaResult = CreateTariffRequestSchema.safeParse(payload);
  if (!schemaResult.success) {
    for (const issue of schemaResult.error.issues) {
      const fieldPath = issue.path.join('.');
      fieldErrors[fieldPath] = issue.message;
      problems.push({
        code: 'STRUCTURAL_ERROR' as unknown as TariffProblem['code'],
        path: fieldPath,
        message: issue.message,
      });
    }
  }

  // 2. Domain engine validation (overlaps, coverage gaps, DST, precedence ties)
  // Only execute domain validation if payload looks like a plausible tariff definition
  try {
    const engineProblems = validateTariff(payload);
    for (const p of engineProblems) {
      problems.push(p);
      if (fieldErrors[p.path] === undefined) {
        fieldErrors[p.path] = p.message;
      }
    }
  } catch (err) {
    // Should never throw per engine contract, but safeguard against crashes
    const message = err instanceof Error ? err.message : 'Unknown validation error';
    problems.push({
      code: 'UNEXPECTED_ERROR' as unknown as TariffProblem['code'],
      path: 'form',
      message,
    });
  }

  return {
    valid: problems.length === 0,
    problems,
    fieldErrors,
  };
}
