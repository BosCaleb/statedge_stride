import { describe, expect, it } from 'vitest';
import { consentRuleProblem, isMinor } from './consent';
import { formatDisplayDate } from './dates';
import { shortDisplayName } from './reportSnapshot';

describe('consent rules', () => {
  it('treats an athlete as a minor while the current year minus the birth year is 18 or less', () => {
    expect(isMinor(2008, 2026)).toBe(true);
    expect(isMinor(2007, 2026)).toBe(false);
  });

  it('needs a guardian for a minor and refuses verbal consent for one', () => {
    expect(consentRuleProblem(2012, 2026, 'athlete', 'paper_form')).toBe('guardian_required');
    expect(consentRuleProblem(2012, 2026, 'guardian', 'verbal')).toBe('verbal_not_allowed');
    expect(consentRuleProblem(2012, 2026, 'guardian', 'paper_form')).toBeNull();
  });

  it('lets an adult consent verbally, and reserves digital evidence for later', () => {
    expect(consentRuleProblem(1995, 2026, 'athlete', 'verbal')).toBeNull();
    expect(consentRuleProblem(1995, 2026, 'athlete', 'digital')).toBe('digital_reserved');
  });
});

describe('display helpers', () => {
  it('formats dates as dd/MM/yyyy in UTC', () => {
    expect(formatDisplayDate('2026-03-04')).toBe('04/03/2026');
    expect(formatDisplayDate('2026-12-31T23:30:00Z')).toBe('31/12/2026');
    expect(formatDisplayDate('not a date')).toBe('');
  });

  it('shortens a name to the first name and last initial', () => {
    expect(shortDisplayName('Ayanda', 'mokoena')).toBe('Ayanda M.');
    expect(shortDisplayName(' Lee ', '')).toBe('Lee');
    expect(shortDisplayName('Zoë', 'Ésterhuizen')).toBe('Zoë É.');
  });
});
