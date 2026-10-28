import { expect, PEOPLE, signIn, test } from './fixtures';

test.describe('settings and invites', () => {
  test('an administrator invites a coach, who joins the organisation with the link', async ({
    page,
    api,
    browser,
  }) => {
    await signIn(page, PEOPLE.adminA, '/settings');
    await expect(page.getByText('2 of 3 seats used')).toBeVisible();
    await page.getByLabel('Email address').fill(PEOPLE.newcomer.email);
    await page.getByRole('button', { name: 'Create invite link' }).click();
    const url = await page.locator('p', { hasText: '/invite/' }).first().innerText();
    expect(url).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
    await expect(page.getByText('3 of 3 seats used')).toBeVisible();

    // The invited person, in a separate browser, follows the link.
    const context = await browser.newContext();
    const other = await context.newPage();
    await api.attach(other);
    await other.addInitScript(() => localStorage.setItem('stride.capabilitiesChecked', 'e2e'));
    await other.goto(new URL(url).pathname);
    await other.getByRole('button', { name: 'Sign in' }).click();
    await other.getByRole('button', { name: `Sign in as ${PEOPLE.newcomer.email}` }).click();
    await expect(other.getByText('You have joined Seeded School A.')).toBeVisible();
    await other.getByRole('button', { name: 'Continue' }).click();
    await expect(
      other.getByRole('heading', { name: `Hello, ${PEOPLE.newcomer.name}` }),
    ).toBeVisible();
    await context.close();
  });

  test('an invite sent to someone else is refused', async ({ page, api, browser }) => {
    await signIn(page, PEOPLE.adminA, '/settings');
    await page.getByLabel('Email address').fill('someone.else@example.org');
    await page.getByRole('button', { name: 'Create invite link' }).click();
    const url = await page.locator('p', { hasText: '/invite/' }).first().innerText();
    const context = await browser.newContext();
    const other = await context.newPage();
    await api.attach(other);
    await other.addInitScript(() => localStorage.setItem('stride.capabilitiesChecked', 'e2e'));
    await other.goto(new URL(url).pathname);
    await other.getByRole('button', { name: 'Sign in' }).click();
    await other.getByRole('button', { name: `Sign in as ${PEOPLE.newcomer.email}` }).click();
    await expect(other.getByRole('alert')).toContainText('sent to a different email address');
    await context.close();
  });

  test('a full organisation refuses a new invite', async ({ page, api }) => {
    void api;
    await signIn(page, PEOPLE.adminB, '/settings');
    await expect(page.getByText('1 of 2 seats used')).toBeVisible();
    await page.getByLabel('Email address').fill('first@example.org');
    await page.getByRole('button', { name: 'Create invite link' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByLabel('Email address').fill('second@example.org');
    await page.getByRole('button', { name: 'Create invite link' }).click();
    await expect(page.getByRole('alert')).toContainText('All seats are in use');
  });

  test('changes the retention period and shows the activity log', async ({ page, api }) => {
    void api;
    await signIn(page, PEOPLE.adminA, '/settings');
    await page.getByLabel('Keep clips on phones for (days)').fill('30');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved' }).last()).toBeVisible();
    await page.getByLabel('Email address').fill('logged@example.org');
    await page.getByRole('button', { name: 'Create invite link' }).click();
    await page.reload();
    await expect(page.getByText('Invited a coach')).toBeVisible();
  });
});
