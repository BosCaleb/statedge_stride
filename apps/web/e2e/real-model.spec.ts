import { CLIPS, clickFramePixel, CONES, drawAthleteBox } from './capture';
import { expect, PEOPLE, signIn, test } from './fixtures';

// Nightly only (STRIDE_REAL_MODEL=1, see .github/workflows/nightly.yml): one short clip through
// the real MediaPipe model on the CPU delegate, to catch dependency regressions in the model,
// its WASM runtime and the worker. Needs `pnpm fetch-models` before the e2e build. The clip is
// the synthetic stick figure, so the check is that the model loads and runs to an outcome,
// not what it measures.

test.skip(!process.env.STRIDE_REAL_MODEL, 'set STRIDE_REAL_MODEL=1 to run the real model');
test.setTimeout(5 * 60_000);

test('the real pose model loads and runs on the CPU in the worker', async ({ page, api }) => {
  api.seedAthlete('a', { firstName: 'Lerato', lastName: 'Molefe', birthYear: 2000 });
  await page.addInitScript(() => localStorage.setItem('stride.e2e.poseDelegate', 'CPU'));
  await signIn(page, PEOPLE.coachA, '/sessions/new');
  await page.getByRole('radio', { name: /Distance/ }).check();
  await page.getByRole('checkbox', { name: /Lerato Molefe/ }).check();
  await page.getByRole('button', { name: 'Create session and import clips' }).click();
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
  await expect(page.getByText('Finding the athlete')).toBeVisible({ timeout: 60_000 });

  // Any end is fine (a result, a failed gate, or "no person" on a stick figure), except the
  // model failing to load or the job crashing.
  const ended = page
    .getByRole('heading', {
      name: /This clip did not pass the quality checks|The analysis did not finish/,
    })
    .or(page.getByRole('article', { name: 'Cadence' }));
  await expect(ended.first()).toBeVisible({ timeout: 4 * 60_000 });
  await expect(page.getByText(/pose model could not be loaded/)).toHaveCount(0);
  await expect(page.getByText(/stopped unexpectedly/)).toHaveCount(0);
});
