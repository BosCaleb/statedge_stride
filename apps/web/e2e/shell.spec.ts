import AxeBuilder from '@axe-core/playwright';
import { expect, PEOPLE, signIn, test } from './fixtures';

test.describe('app shell', () => {
  test('a coach signs in and lands on the page they asked for', async ({ page, api }) => {
    await signIn(page, PEOPLE.coachA, '/athletes');
    await expect(page.getByRole('heading', { name: 'Athletes' })).toBeVisible();
    await expect(page.getByRole('status', { name: /Sync status/ })).toContainText('Saved');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link')).toHaveText(['Home', 'Athletes', 'Guide']);
    await nav.getByRole('link', { name: 'Home' }).click();
    await expect(page.getByRole('heading', { name: 'Hello, Sipho Coach' })).toBeVisible();
    expect(api.calls).toContain('GET /v1/me');
  });

  test('an administrator also sees Settings', async ({ page, api }) => {
    void api;
    await signIn(page, PEOPLE.adminA);
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  test('a person without an organisation is told to use their invite', async ({ page, api }) => {
    void api;
    await signIn(page, PEOPLE.newcomer);
    await expect(
      page.getByRole('heading', { name: 'Not part of an organisation yet' }),
    ).toBeVisible();
  });

  test('the capture guide opens without signing in', async ({ page, api }) => {
    void api;
    await page.goto('/guide');
    await expect(page.getByRole('heading', { name: 'Capture guide' })).toBeVisible();
  });

  test('sign-out returns to the sign-in page', async ({ page, api }) => {
    void api;
    await signIn(page, PEOPLE.coachA);
    await page.getByRole('button', { name: 'Account' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Local sign-in' })).toBeVisible();
  });

  test('switches to the dark theme and remembers it', async ({ page, api }) => {
    void api;
    await signIn(page, PEOPLE.coachA);
    await page.getByRole('button', { name: 'Account' }).click();
    await page.getByLabel('Dark').check();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('Home has no serious accessibility problems', async ({ page, api }) => {
    void api;
    await signIn(page, PEOPLE.adminA);
    await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
