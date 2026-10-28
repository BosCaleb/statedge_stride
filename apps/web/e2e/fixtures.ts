import AxeBuilder from '@axe-core/playwright';
import { test as base, expect, type Page } from '@playwright/test';
import { DEV_IDENTITIES } from '@stride/shared/devIdentities';
import { StubApi } from './stubApi';

// Every test gets a stubbed API and fails on any content security policy violation.

export type Person = (typeof DEV_IDENTITIES)[number];
export const PEOPLE = {
  adminA: DEV_IDENTITIES[0],
  coachA: DEV_IDENTITIES[1],
  adminB: DEV_IDENTITIES[2],
  newcomer: DEV_IDENTITIES[3],
} as const;

export const test = base.extend<{ api: StubApi; cspViolations: string[] }>({
  cspViolations: async ({ page }, use) => {
    const violations: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && /Content Security Policy/i.test(message.text()))
        violations.push(message.text());
    });
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (event) => {
        console.error(
          `Content Security Policy violation: ${event.violatedDirective} ${event.blockedURI}`,
        );
      });
    });
    await use(violations);
    expect(violations, 'content security policy violations').toEqual([]);
  },
  api: async ({ page, cspViolations }, use) => {
    void cspViolations;
    const api = new StubApi();
    await api.attach(page);
    await page.addInitScript(() => localStorage.setItem('stride.capabilitiesChecked', 'e2e'));
    await use(api);
  },
});

/** Signs in through the fake sign-in picker, as a real coach would tap it. */
export async function signIn(page: Page, person: Person, path = '/'): Promise<void> {
  await page.goto(path);
  await page.getByRole('button', { name: `Sign in as ${person.email}` }).click();
}

/** Fails on serious or critical WCAG 2.1 AA problems on the current page. */
export async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    serious.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`),
  ).toEqual([]);
}

export { expect };
