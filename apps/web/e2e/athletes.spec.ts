import { expect, PEOPLE, signIn, test } from './fixtures';

const minorYear = String(new Date().getUTCFullYear() - 14);

test.describe('athletes and consent', () => {
  test('a coach adds a minor, records a guardian consent, and sees the badge', async ({
    page,
    api,
  }) => {
    await signIn(page, PEOPLE.coachA, '/athletes');
    await expect(page.getByRole('heading', { name: 'No athletes yet' })).toBeVisible();
    await page.getByRole('link', { name: 'Add athlete' }).click();
    await page.getByLabel('First name').fill('Lerato');
    await page.getByLabel('Last name').fill('Molefe');
    await page.getByLabel('Year of birth').fill(minorYear);
    await page.getByRole('button', { name: 'Save and record consent' }).click();

    await expect(page.getByRole('heading', { name: 'Record consent' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'The athlete' })).toBeDisabled();
    await page.getByLabel('Name of the person consenting').fill('Grace Molefe');
    await page.getByLabel('Relationship to the athlete').fill('Mother');
    await page.getByRole('button', { name: 'Save consent' }).click();

    await expect(page.getByRole('heading', { name: 'Lerato Molefe' })).toBeVisible();
    await expect(page.getByText('Analysis: consent recorded')).toBeVisible();
    await expect(page.getByText('Sharing: consent recorded')).toBeVisible();
    await expect(page.getByRole('button', { name: /Sync status: Saved/ })).toBeVisible();
    expect(api.calls.filter((c) => c.startsWith('PUT /v1/consents/'))).toHaveLength(2);
    const [consent] = [...api.consents.values()];
    expect(consent).toMatchObject({
      givenBy: 'guardian',
      givenByName: 'Grace Molefe',
      relationship: 'Mother',
    });

    await page.getByRole('link', { name: 'Athletes' }).click();
    await expect(page.getByRole('link', { name: /Lerato Molefe/ })).toContainText(
      'Analysis: consent recorded',
    );
  });

  test('withdrawing a consent shows at once and reaches the API', async ({ page, api }) => {
    await signIn(page, PEOPLE.coachA, '/athletes/new');
    await page.getByLabel('First name').fill('Johan');
    await page.getByLabel('Last name').fill('van Wyk');
    await page.getByLabel('Year of birth').fill('1999');
    await page.getByRole('button', { name: 'Save and record consent' }).click();
    await page.getByRole('radio', { name: /verbally/ }).check();
    await page.getByRole('button', { name: 'Save consent' }).click();
    await expect(page.getByText('Analysis: consent recorded')).toBeVisible();
    await page.getByRole('button', { name: 'Withdraw' }).first().click();
    await page
      .getByRole('dialog', { name: 'Withdraw consent?' })
      .getByRole('button', { name: 'Withdraw' })
      .click();
    await expect(page.getByText('Analysis: no consent')).toBeVisible();
    await expect
      .poll(() => api.calls.some((c) => /^POST \/v1\/consents\/.+\/withdraw$/.test(c)))
      .toBe(true);
  });

  test('searching filters on the phone and never sends a name to the API', async ({
    page,
    api,
  }) => {
    await signIn(page, PEOPLE.coachA, '/athletes/new');
    for (const [first, last] of [
      ['Sipho', 'Dube'],
      ['Anna', 'Botha'],
    ]) {
      await page.goto('/athletes/new');
      await page.getByLabel('First name').fill(first ?? '');
      await page.getByLabel('Last name').fill(last ?? '');
      await page.getByLabel('Year of birth').fill('2001');
      await page.getByRole('button', { name: 'Save and record consent' }).click();
      await expect(page.getByRole('heading', { name: 'Record consent' })).toBeVisible();
    }
    await page.getByRole('link', { name: 'Athletes' }).click();
    await page.getByLabel('Search athletes').fill('both');
    await expect(page.getByRole('link', { name: /Anna Botha/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Sipho Dube/ })).toBeHidden();
    expect(api.calls.some((c) => /[?&]q=/.test(c) || /Botha/i.test(c))).toBe(false);
  });

  test('an administrator deletes an athlete after typing the name', async ({ page, api }) => {
    await signIn(page, PEOPLE.adminA, '/athletes/new');
    await page.getByLabel('First name').fill('Delete');
    await page.getByLabel('Last name').fill('Me');
    await page.getByLabel('Year of birth').fill('2000');
    await page.getByRole('button', { name: 'Save and record consent' }).click();
    await expect(page.getByRole('heading', { name: 'Record consent' })).toBeVisible();
    await page.getByRole('link', { name: 'Athletes' }).click();
    await page.getByRole('link', { name: /Delete Me/ }).click();
    await page.getByRole('button', { name: 'Delete athlete and all data' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete this athlete?' });
    await expect(dialog.getByRole('button', { name: 'Delete for good' })).toBeDisabled();
    await dialog.getByLabel('Full name').fill('delete me');
    await dialog.getByRole('button', { name: 'Delete for good' }).click();
    await expect(page.getByRole('heading', { name: 'Athletes', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /Delete Me/ })).toBeHidden();
    expect(api.athletes.size).toBe(0);
  });

  test('a coach does not see the delete and export tools', async ({ page, api }) => {
    void api;
    await signIn(page, PEOPLE.coachA, '/athletes/new');
    await page.getByLabel('First name').fill('Coach');
    await page.getByLabel('Last name').fill('View');
    await page.getByLabel('Year of birth').fill('2000');
    await page.getByRole('button', { name: 'Save and record consent' }).click();
    await page.getByRole('link', { name: 'Athletes' }).click();
    await page.getByRole('link', { name: /Coach View/ }).click();
    await expect(page.getByRole('heading', { name: 'Coach View' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete athlete and all data' })).toBeHidden();
  });
});
