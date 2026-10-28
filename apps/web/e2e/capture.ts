import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { expect, PEOPLE, signIn } from './fixtures';
import type { StubApi } from './stubApi';

// Helpers for the capture tests: the synthetic clips, marker taps and the athlete box.

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

/** Imports the synthetic calibration clip and run into a new distance session, calibrated. */
export async function importAndCalibrate(
  page: Page,
  api: StubApi,
  fixture = 'distance-ltr.skp1.gz',
): Promise<string> {
  const athleteId = api.seedAthlete('a', {
    firstName: 'Lerato',
    lastName: 'Molefe',
    birthYear: 2000,
  });
  await page.addInitScript((name) => localStorage.setItem('stride.e2e.poseFixture', name), fixture);
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
