import { expect, PEOPLE, signIn, test } from './fixtures';

test.describe('outbox', () => {
  test('saves while offline and sends in order when the network returns', async ({
    page,
    api,
    context,
  }) => {
    // First once online, as a coach would have used the app before (the service worker, which
    // keeps the screens available offline, is off in these tests).
    await signIn(page, PEOPLE.coachA, '/athletes');
    await page.getByRole('link', { name: 'Add athlete' }).click();
    await page.getByLabel('First name').fill('Online');
    await page.getByLabel('Last name').fill('First');
    await page.getByLabel('Year of birth').fill('2000');
    await page.getByRole('button', { name: 'Save and record consent' }).click();
    await page.getByRole('radio', { name: /verbally/ }).check();
    await page.getByRole('button', { name: 'Save consent' }).click();
    await expect(page.getByRole('heading', { name: 'Online First' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Sync status: Saved/ })).toBeVisible();
    const before = api.calls.length;

    await context.setOffline(true);
    api.offline = true;
    await page.getByRole('link', { name: 'Athletes' }).click();
    await page.getByRole('link', { name: 'Add athlete' }).click();
    await page.getByLabel('First name').fill('Offline');
    await page.getByLabel('Last name').fill('Runner');
    await page.getByLabel('Year of birth').fill('2000');
    await page.getByRole('button', { name: 'Save and record consent' }).click();
    await page.getByRole('radio', { name: /verbally/ }).check();
    await page.getByRole('button', { name: 'Save consent' }).click();
    await expect(page.getByText('Analysis: consent recorded')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Sync status: Offline, 3 waiting/ }),
    ).toBeVisible();
    // The longer pill wraps rather than pushing the header, and the page, wider than the phone.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
    expect(api.athletes.size).toBe(1);

    api.offline = false;
    await context.setOffline(false);
    await expect(page.getByRole('button', { name: /Sync status: Saved/ })).toBeVisible();
    const writes = api.calls.slice(before).filter((c) => c.startsWith('PUT '));
    expect(writes).toHaveLength(3);
    expect(writes[0]).toMatch(/^PUT \/v1\/athletes\//);
    expect(writes.slice(1).every((c) => c.startsWith('PUT /v1/consents/'))).toBe(true);
    expect(api.athletes.size).toBe(2);
    expect(api.consents.size).toBe(4);
  });

  test('a refused write needs attention, and can be retried', async ({ page, api }) => {
    api.failNext('putAthlete', 409, 'conflict');
    await signIn(page, PEOPLE.coachA, '/athletes/new');
    await page.getByLabel('First name').fill('Refused');
    await page.getByLabel('Last name').fill('Once');
    await page.getByLabel('Year of birth').fill('2000');
    await page.getByRole('button', { name: 'Save and record consent' }).click();
    const pill = page.getByRole('button', { name: /Sync status: Needs attention/ });
    await expect(pill).toBeVisible();
    await pill.click();
    const panel = page.getByRole('dialog', { name: 'Changes waiting to be saved' });
    await expect(panel).toContainText('This was already saved with different details.');
    await panel.getByRole('button', { name: 'Retry' }).click();
    await expect(panel).toContainText('Everything is saved.');
    expect(api.athletes.size).toBe(1);
  });

  test('a refused write can be discarded', async ({ page, api }) => {
    api.failNext('putAthlete', 400, 'validation');
    await signIn(page, PEOPLE.coachA, '/athletes/new');
    await page.getByLabel('First name').fill('Discard');
    await page.getByLabel('Last name').fill('This');
    await page.getByLabel('Year of birth').fill('2000');
    await page.getByRole('button', { name: 'Save and record consent' }).click();
    await page.getByRole('button', { name: /Sync status: Needs attention/ }).click();
    const panel = page.getByRole('dialog', { name: 'Changes waiting to be saved' });
    await panel.getByRole('button', { name: 'Discard' }).click();
    await page
      .getByRole('dialog', { name: 'Discard this change?' })
      .getByRole('button', { name: 'Discard' })
      .click();
    await expect(panel).toContainText('Everything is saved.');
  });
});
