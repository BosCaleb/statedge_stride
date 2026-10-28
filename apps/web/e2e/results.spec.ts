import type { Page } from '@playwright/test';
import { CLIPS, drawAthleteBox, importAndCalibrate } from './capture';
import { expect, expectAccessible, test } from './fixtures';
import type { StubApi } from './stubApi';

// Saving a result (M4): every write goes through the outbox once and in order, online or not;
// a refused write says why and can be retried; then the athlete's history, a trend and the
// before-and-after view of two analyses.

// Each test analyses a run on the phone first, which takes about 20 seconds.
test.describe.configure({ timeout: 60_000 });

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** The writes the API received since `from`, with the ids blanked out. */
const writesSince = (api: StubApi, from: number) =>
  api.calls
    .slice(from)
    .filter((c) => c.startsWith('PUT '))
    .map((c) => c.replace(UUID, ':id'));

const SAVE_WRITES = [
  'PUT /v1/calibrations/:id',
  'PUT /v1/clips/:id',
  'PUT /v1/analyses/:id',
  'PUT /v1/analyses/:id/keypoints',
];

/** Analyses the imported run and returns the result's id. */
async function analyse(page: Page): Promise<string> {
  await page.getByRole('button', { name: /Lerato Molefe/ }).click();
  await drawAthleteBox(page);
  await page.getByRole('button', { name: 'Analyse this run' }).click();
  await expect(page).toHaveURL(/\/analyses\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByRole('article', { name: 'Cadence' })).toBeVisible();
  return new URL(page.url()).pathname.split('/').at(-1) ?? '';
}

const save = (page: Page) => page.getByRole('button', { name: 'Save', exact: true }).click();

test.describe('save', () => {
  test('saves the result, its keypoints and the note, each once and in order', async ({
    page,
    api,
  }) => {
    const athleteId = await importAndCalibrate(page, api);
    const id = await analyse(page);
    await page.getByLabel('Coach notes').fill('Arms cross the body at contact.');
    const before = api.calls.length;
    await save(page);
    await expect(page.getByText('Saved for your organisation.')).toBeVisible();
    expect(writesSince(api, before)).toEqual([...SAVE_WRITES, 'PUT /v1/notes/:id']);
    expect(api.analyses.get(id)?.summary.hasKeypoints).toBe(true);
    await expect(page.getByText('Arms cross the body at contact.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    await expectAccessible(page);

    // Notes on the saved analysis: add one, delete the first.
    await page.getByLabel('Add a note').fill('Look again in two weeks.');
    await page.getByRole('button', { name: 'Add note' }).click();
    await expect(page.getByText('Look again in two weeks.')).toBeVisible();
    await expect.poll(() => api.notes.size).toBe(2);
    await page
      .getByRole('listitem')
      .filter({ hasText: 'Arms cross the body' })
      .getByRole('button', { name: 'Delete note' })
      .click();
    await expect(page.getByText('Arms cross the body at contact.')).toHaveCount(0);
    await expect.poll(() => api.notes.size).toBe(1);

    // Still saved after a reload, and listed in the athlete's history.
    await page.reload();
    await expect(page.getByText('Saved for your organisation.')).toBeVisible();
    await page.goto(`/athletes/${athleteId}`);
    const history = page.getByRole('region', { name: 'History' });
    await expect(history.getByRole('link', { name: /Distance/ })).toHaveCount(1);
    await expect(history.getByText('Tick two analyses to compare them.')).toBeVisible();
  });

  test('saving offline waits, then sends every write once and in order', async ({
    page,
    api,
    context,
  }) => {
    await importAndCalibrate(page, api);
    await analyse(page);
    api.offline = true;
    await context.setOffline(true);
    const before = api.calls.length;
    await save(page);
    await expect(
      page.getByText('Waiting to be saved. It is sent when the phone is online.'),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Sync status: Offline, 4 waiting/ }),
    ).toBeVisible();
    expect(api.analyses.size).toBe(0);

    api.offline = false;
    await context.setOffline(false);
    await expect(page.getByText('Saved for your organisation.')).toBeVisible();
    expect(writesSince(api, before)).toEqual(SAVE_WRITES);
    expect(api.analyses.size).toBe(1);
    await expect(page.getByRole('button', { name: /Sync status: Saved/ })).toBeVisible();
  });

  test('a refused save says why, and goes through when retried', async ({ page, api }) => {
    await importAndCalibrate(page, api);
    const id = await analyse(page);
    api.failNext('putAnalysis', 422, 'consent_required');
    await save(page);
    await expect(
      page.getByText('Not saved. Open the sync status at the top to see why.'),
    ).toBeVisible();
    await page.getByRole('button', { name: /Sync status: Needs attention/ }).click();
    const panel = page.getByRole('dialog', { name: 'Changes waiting to be saved' });
    await expect(panel).toContainText(
      'Consent is missing, or must come from a parent or guardian.',
    );
    await expectAccessible(page);
    await panel.getByRole('button', { name: 'Retry' }).click();
    await expect(panel).toContainText('Everything is saved.');
    expect(api.analyses.get(id)?.summary.hasKeypoints).toBe(true);
  });
});

test.describe('history and comparison', () => {
  test('shows a trend, and plays two analyses side by side with the changes', async ({
    page,
    api,
  }) => {
    // An analysis on the phone, then both clips played through once.
    test.setTimeout(90_000);
    const athleteId = await importAndCalibrate(page, api);
    const id = await analyse(page);
    await save(page);
    await expect(page.getByText('Saved for your organisation.')).toBeVisible();
    // Two weeks earlier: filmed at 120 fps, with a cadence 4 steps/min lower.
    api.copyAnalysis(id, 14, (r) => ({
      ...r,
      captureFps: 120,
      metrics: r.metrics.map((m) =>
        m.id === 'cadence' && m.value !== null ? { ...m, value: m.value - 4 } : m,
      ),
    }));

    await page.goto(`/athletes/${athleteId}`);
    const history = page.getByRole('region', { name: 'History' });
    await expect(history.getByRole('link', { name: /Distance/ })).toHaveCount(2);
    await expect(history.getByLabel('Measurement')).toHaveValue('cadence');
    await expect(history.getByRole('img', { name: 'Cadence across sessions' })).toBeVisible();
    await history.getByText('Show the values').click();
    await expect(history.getByRole('row')).toHaveCount(3);
    await expectAccessible(page);

    for (const box of await history.getByRole('checkbox', { name: /Compare the analysis/ }).all())
      await box.check();
    await history.getByRole('link', { name: 'Compare the two' }).click();

    await expect(page).toHaveURL(/\/compare\?a=.+&b=.+/);
    await expect(page.getByRole('heading', { name: 'Before and after' })).toBeVisible();
    await expect(page.getByText('The clips were filmed at different frame rates.')).toBeVisible();
    const cadence = page.getByRole('row', { name: /^Cadence/ });
    await expect(cadence).toContainText('+4 steps/min');
    await expect(cadence).toContainText('Higher');
    await expect(cadence).toContainText(/(High|Medium|Low) confidence/);

    // The later run plays from this phone; the earlier one needs its original file.
    const earlier = page.getByRole('figure', { name: /^Earlier, / });
    const later = page.getByRole('figure', { name: /^Later, / });
    await expect(later.getByRole('group', { name: /^Later, / })).toBeVisible();
    await expect(earlier.getByText('The clip is not on this phone.')).toBeVisible();
    await earlier.getByLabel('Pick the original clip to play it').setInputFiles(CLIPS.run);
    await expect(earlier.getByRole('group', { name: /^Earlier, / })).toBeVisible();

    // Both start on their first initial contact (the same frame here), and step together.
    const events = api.analyses.get(id)?.result.events ?? [];
    const contact = Math.min(...events.map((e) => e.icFrame));
    const at = (frame: number) => new RegExp(`^Frame ${frame + 1} of \\d+`);
    for (const player of [earlier, later])
      await expect(player.getByText(at(contact))).toBeVisible();
    await page.getByRole('button', { name: 'Both forward one frame' }).click();
    for (const player of [earlier, later])
      await expect(player.getByText(at(contact + 1))).toBeVisible();

    await page.getByRole('button', { name: '1×', exact: true }).click();
    await page.getByRole('button', { name: 'Play both' }).click();
    await expect(page.getByRole('button', { name: 'Pause both' })).toBeVisible();
    // Once both passes have played to the end.
    await expect(page.getByRole('button', { name: 'Play both' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Back to the first contact' }).click();
    for (const player of [earlier, later])
      await expect(player.getByText(at(contact))).toBeVisible();
    await expectAccessible(page);
  });
});
