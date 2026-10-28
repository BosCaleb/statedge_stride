import { CLIPS } from './capture';
import { expect, expectAccessible, PEOPLE, signIn, test } from './fixtures';

test.describe('device check', () => {
  test('checks a test clip, shows the result, and records it with the phone model', async ({
    page,
    api,
  }) => {
    await signIn(page, PEOPLE.coachA, '/device-check');
    await expect(page.getByRole('heading', { name: 'Device check' })).toBeVisible();
    await page.getByLabel('Phone model').fill('Galaxy S23 Ultra');
    await page.locator('input[type=file]').setInputFiles(CLIPS.run);
    await expect(page.getByRole('heading', { name: 'Pass' })).toBeVisible();
    const card = page.getByRole('article', { name: 'synthetic-run-240fps.mp4' });
    await expect(card).toContainText('240 fps');
    await expect(card).toContainText('1920 × 1080');
    await expect(card).toContainText('VP9');
    await expect(card).toContainText('Regular');
    await expect(page.getByRole('row', { name: /Samsung Galaxy S23 Ultra/ })).toBeVisible();
    await expectAccessible(page);

    await page.getByRole('button', { name: 'Record this result' }).click();
    await expect(page.getByText('Recorded. It is sent when the phone is online.')).toBeVisible();
    await expect.poll(() => api.deviceChecks.size).toBe(1);
    const [check] = [...api.deviceChecks.values()];
    expect(check).toMatchObject({
      deviceModel: 'Galaxy S23 Ultra',
      declaredFps: 240,
      widthPx: 1920,
      heightPx: 1080,
      result: 'pass',
      reason: null,
    });
    expect(check?.detectedFps).toBeCloseTo(240, 0);
  });
});

test.describe('developer pages', () => {
  test('the component gallery renders every component', async ({ page, api }) => {
    void api;
    await page.goto('/dev/gallery');
    await expect(page.getByRole('heading', { name: 'Component gallery' })).toBeVisible();
    for (const name of ['CalibrationOverlay', 'MetricCard', 'GateBanner', 'JobProgress']) {
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: 'Passed with conditions' })).toBeVisible();
  });
});
