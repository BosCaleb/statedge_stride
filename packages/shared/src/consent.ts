import type { ConsentEvidence, ConsentGiver } from './enums';

/**
 * The app treats an athlete as a minor when the current year minus the birth year is 18 or less
 * (deliberately conservative). A minor's consent must come from a parent or guardian.
 */
export function isMinor(birthYear: number, currentYear: number): boolean {
  return currentYear - birthYear <= 18;
}

export type ConsentProblem = 'guardian_required' | 'verbal_not_allowed' | 'digital_reserved';

/** The consent rules that do not depend on stored data. */
export function consentRuleProblem(
  birthYear: number,
  currentYear: number,
  givenBy: ConsentGiver,
  evidence: ConsentEvidence,
): ConsentProblem | null {
  const minor = isMinor(birthYear, currentYear);
  if (evidence === 'digital') return 'digital_reserved';
  if (minor && givenBy !== 'guardian') return 'guardian_required';
  if (minor && evidence === 'verbal') return 'verbal_not_allowed';
  return null;
}
