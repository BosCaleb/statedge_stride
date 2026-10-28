import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { expect, expectAccessible, PEOPLE, signIn, test } from './fixtures';
import type { StubApi } from './stubApi';

// Import and calibrate (M3): a session, a calibration clip and a run, two marker taps.

export const CLIPS = {
  calibration: fileURLToPath(
    new URL('../../../fixtures/clips/synthetic-calibration-240fps.mp4', import.meta.url),
  ),
  run: fileURLToPath(new URL('../../../fixtures/clips/synthetic-run-240fps.mp4', import.meta.url)),
};

/** The cones in the synthetic calibration clip, 5 m apart (scripts/generate-test-clips.ts). */
export const CONES = [
  { x: 585, y: 918 },
  { x: 1335, y: 918 },
];

/** Clicks a frame pixel of a canvas that shows the whole 1920 by 1080 frame. */
export async function clickFramePixel(canvas: Locator, p: { x: number; y: number }) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not visible');
  await canvas.click({ position: { x: (p.x / 1920) * box.width, y: (p.y / 1080) * box.height } });
}

test.describe('import and calibrate', () => {
  test('a coach creates a session, imports a calibration clip and a run, and calibrates', async ({
    page,
    api,
  }) => {
    const athleteId = api.seedAthlete('a', {
      firstName: 'Lerato',
      lastName: 'Molefe',
      birthYear: 2000,
    });
    await signIn(page, PEOPLE.coachA, '/sessions/new');
    await page.getByLabel('Place').fill('Main track');
    await page.getByRole('radio', { name: /Distance/ }).check();
    await page.getByRole('checkbox', { name: /Lerato Molefe/ }).check();
    await page.getByRole('button', { name: 'Create session and import clips' }).click();

    await expect(page.getByRole('heading', { name: 'Import clips' })).toBeVisible();
    await expect.poll(() => api.sessions.size).toBe(1);
    await page.locator('input[type=file]').setInputFiles([CLIPS.calibration, CLIPS.run]);

    const calibration = page.getByRole('article', { name: 'synthetic-calibration-240fps.mp4' });
    const run = page.getByRole('article', { name: 'synthetic-run-240fps.mp4' });
    await expect(calibration.getByText('240 fps')).toBeVisible();
    await expect(calibration.getByText('1920 × 1080')).toBeVisible();
    await expect(calibration.getByText('VP9')).toBeVisible();
    await expect(run.getByText('Regular')).toBeVisible();
    await calibration.getByRole('radio', { name: 'The calibration clip' }).check();
    // The only athlete picked for the session is chosen for the run.
    await expect(run.getByLabel('Athlete')).toHaveValue(athleteId);
    await expect(run.getByText('Analysis: consent recorded')).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Import', exact: true }).click();

    await expect(page.getByText('Tap marker A')).toBeVisible();
    const canvas = page.getByLabel(/Calibration frame/);
    await clickFramePixel(canvas, CONES[0] ?? { x: 0, y: 0 });
    await expect(page.getByText('Now tap marker B')).toBeVisible();
    await clickFramePixel(canvas, CONES[1] ?? { x: 0, y: 0 });
    await expect(page.getByText(/Scale: 1(4[5-9]|5[0-5])\.\d pixels per metre/)).toBeVisible();
    await page.getByRole('button', { name: 'Use this calibration' }).click();

    await expect(page.getByText('2 clips imported.')).toBeVisible();
    await page.getByRole('link', { name: 'Go to the session' }).click();
    await expect(
      page.getByText(/5\.00 m between the markers · 1\d\d pixels per metre/),
    ).toBeVisible();
    await expect(page.getByRole('article', { name: 'synthetic-run-240fps.mp4' })).toContainText(
      'Copy kept on this phone',
    );
  });

  test('warns when the markers are close together, and needs an athlete for each run', async ({
    page,
    api,
  }) => {
    api.seedAthlete('a', { firstName: 'Johan', lastName: 'van Wyk', birthYear: 1999 });
    await signIn(page, PEOPLE.coachA, '/sessions/new');
    await page.getByRole('button', { name: 'Create session and import clips' }).click();
    await page.locator('input[type=file]').setInputFiles([CLIPS.calibration, CLIPS.run]);
    const calibration = page.getByRole('article', { name: 'synthetic-calibration-240fps.mp4' });
    await expect(calibration.getByText('240 fps')).toBeVisible();
    await calibration.getByRole('radio', { name: 'The calibration clip' }).check();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Choose the athlete for each run.');

    await page
      .getByRole('article', { name: 'synthetic-run-240fps.mp4' })
      .getByLabel('Athlete')
      .selectOption({ label: 'Johan van Wyk' });
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const canvas = page.getByLabel(/Calibration frame/);
    await clickFramePixel(canvas, { x: 900, y: 918 });
    await clickFramePixel(canvas, { x: 1000, y: 918 });
    await expect(page.getByText(/close together in the picture/)).toBeVisible();
    await page.getByRole('button', { name: 'Skip calibration' }).click();
    await expect(page.getByText('2 clips imported.')).toBeVisible();
  });
});

/** Imports the synthetic calibration clip and run into a new distance session, calibrated. */
export async function importAndCalibrate(page: Page, api: StubApi): Promise<string> {
  const athleteId = api.seedAthlete('a', {
    firstName: 'Lerato',
    lastName: 'Molefe',
    birthYear: 2000,
  });
  await page.addInitScript(() =>
    localStorage.setItem('stride.e2e.poseFixture', 'distance-ltr.skp1.gz'),
  );
  await signIn(page, PEOPLE.coachA, '/sessions/new');
  await page.getByRole('radio', { name: /Distance/ }).check();
  await page.getByRole('checkbox', { name: /Lerato Molefe/ }).check();
  await page.getByRole('button', { name: 'Create session and import clips' }).click();
  await page.locator('input[type=file]').setInputFiles([CLIPS.calibration, CLIPS.run]);
  const calibration = page.getByRole('article', { name: 'synthetic-calibration-240fps.mp4' });
  await expect(calibration.getByText('240 fps')).toBeVisible();
  await calibration.getByRole('radio', { name: 'The calibration clip' }).check();
  await expect(
    page.getByRole('article', { name: 'synthetic-run-240fps.mp4' }).getByLabel('Athlete'),
  ).toHaveValue(athleteId);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const canvas = page.getByLabel(/Calibration frame/);
  await clickFramePixel(canvas, CONES[0] ?? { x: 0, y: 0 });
  await clickFramePixel(canvas, CONES[1] ?? { x: 0, y: 0 });
  await page.getByRole('button', { name: 'Use this calibration' }).click();
  await expect(page.getByText('2 clips imported.')).toBeVisible();
  return athleteId;
}

/** Drags the athlete box on the first frame of the synthetic run (the runner starts on the left). */
export async function drawAthleteBox(page: Page) {
  const canvas = page.getByLabel(/Frame from the run/);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('frame not visible');
  const at = (x: number, y: number) => ({
    x: box.x + (x / 1920) * box.width,
    y: box.y + (y / 1080) * box.height,
  });
  const from = at(90, 540);
  const to = at(380, 950);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByText(/^Box \d+ × \d+ px/)).toBeVisible();
}

test.describe('analyse', () => {
  test('runs the analysis on the phone and keeps the result', async ({ page, api }) => {
    await importAndCalibrate(page, api);
    await page.getByRole('button', { name: /Lerato Molefe/ }).click();
    await expect(page.getByRole('heading', { name: 'Analyse', exact: true })).toBeVisible();
    await expect(page.getByLabel('Scale for this run')).toHaveValue(/.+/);
    await drawAthleteBox(page);
    await page.getByRole('button', { name: 'Analyse this run' }).click();
    await expect(page.getByRole('dialog', { name: 'Analysing the run' })).toBeVisible();
    await expect(page.getByText('Reading video')).toBeVisible();
    await expect(page).toHaveURL(/\/analyses\/[0-9a-f-]{36}$/, { timeout: 60_000 });

    // The result viewer.
    await expect(page.getByRole('heading', { name: 'Lerato Molefe' })).toBeVisible();
    await expect(page.getByText(/Passed (the quality checks|with conditions)/)).toBeVisible();
    await expect(page.getByText('Not saved yet. It is kept on this phone.')).toBeVisible();
    const cadence = page.getByRole('article', { name: 'Cadence' });
    await expect(cadence).toContainText('steps/min');
    await expect(cadence).toContainText(/(High|Medium|Low) confidence/);
    await expect(cadence).toContainText('Steps per minute, counting both feet.');
    await expect(page.getByRole('heading', { name: 'Main measurements' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Show .+ initial contact$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Show .+ toe-off$/ })).toBeVisible();
    await expect(page.locator('img[src^="blob:"]')).toHaveCount(3);

    // Event markers jump to their frame, and the arrows step one frame.
    const marker = page.getByRole('button', { name: /foot, initial contact, frame \d+$/ }).nth(1);
    const label = (await marker.getAttribute('aria-label')) ?? '';
    const target = Number(/frame (\d+)$/.exec(label)?.[1]);
    await marker.click();
    await expect(page.getByText(new RegExp(`^Frame ${target} of \\d+`))).toBeVisible();
    await page
      .getByRole('group', { name: 'Clip with the skeleton drawn over it' })
      .press('ArrowRight');
    await expect(page.getByText(new RegExp(`^Frame ${target + 1} of \\d+`))).toBeVisible();
    await expect(page.getByRole('cell', { name: /^\d+\.\d°$/ }).first()).toBeVisible();
    await page.getByRole('button', { name: '1/4×' }).click();
    await expect(page.getByRole('button', { name: '1/4×' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expectAccessible(page);

    // The result is on the session page, and survives a reload.
    await page.reload();
    await expect(page.getByRole('article', { name: 'Cadence' })).toBeVisible();
  });
});
