import { CLIPS, CONES, clickFramePixel, drawAthleteBox } from './capture';
import { expect, PEOPLE, signIn, test } from './fixtures';

// The M3 gate: with the network off, import, calibrate, analyse and review, then the queued
// session reaches the API when the network returns. The service worker serves the app shell
// and the code, as on a phone after "Prepare for offline" (the recorded keypoints stand in for
// the pose model in test builds).

test.use({ serviceWorkers: 'allow' });

test('the whole analysis loop works offline', async ({ page, context, api }) => {
  api.seedAthlete('a', { firstName: 'Lerato', lastName: 'Molefe', birthYear: 2000 });
  await page.addInitScript(() =>
    localStorage.setItem('stride.e2e.poseFixture', 'distance-ltr.skp1.gz'),
  );
  await signIn(page, PEOPLE.coachA, '/athletes');
  await expect(page.getByRole('link', { name: /Lerato Molefe/ })).toBeVisible();
  // Wait until the service worker has installed the app and controls the page.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  await expect(page.getByRole('link', { name: /Lerato Molefe/ })).toBeVisible();
  // Let the query persister write the athletes to IndexedDB.
  await page.waitForTimeout(1500);

  api.offline = true;
  await context.setOffline(true);
  await page.goto('/guide');
  await expect(page.getByRole('heading', { name: 'Capture guide' })).toBeVisible();

  await page.goto('/sessions/new');
  await page.getByRole('radio', { name: /Distance/ }).check();
  await page.getByRole('checkbox', { name: /Lerato Molefe/ }).check();
  await page.getByRole('button', { name: 'Create session and import clips' }).click();
  await expect(page.getByRole('button', { name: /Offline, 1 waiting/ })).toBeVisible();
  await page.locator('input[type=file]').setInputFiles([CLIPS.calibration, CLIPS.run]);
  const calibration = page.getByRole('article', { name: 'synthetic-calibration-240fps.mp4' });
  await expect(calibration.getByText('240 fps')).toBeVisible();
  await calibration.getByRole('radio', { name: 'The calibration clip' }).check();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const canvas = page.getByLabel(/Calibration frame/);
  await clickFramePixel(canvas, CONES[0] ?? { x: 0, y: 0 });
  await clickFramePixel(canvas, CONES[1] ?? { x: 0, y: 0 });
  await page.getByRole('button', { name: 'Use this calibration' }).click();
  await page.getByRole('button', { name: /Lerato Molefe/ }).click();
  await drawAthleteBox(page);
  await page.getByRole('button', { name: 'Analyse this run' }).click();
  await expect(page).toHaveURL(/\/analyses\//, { timeout: 60_000 });
  await expect(page.getByRole('article', { name: 'Cadence' })).toBeVisible();
  expect(api.sessions.size).toBe(0);

  // Back online, the outbox flushes on its own (the browser's online event).
  api.offline = false;
  await context.setOffline(false);
  await expect.poll(() => api.sessions.size).toBe(1);
  await expect(page.getByRole('button', { name: /Sync status: Saved/ })).toBeVisible();
});
