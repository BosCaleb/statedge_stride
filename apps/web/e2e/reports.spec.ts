import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { drawAthleteBox, importAndCalibrate } from './capture';
import { expect, expectAccessible, test } from './fixtures';

// Reports and sharing (M5): a PDF made on the phone from a saved result, with the frames and
// notes chosen; the report saved with the athlete; a share link that needs the sharing consent,
// opens signed out with the first name and initial only and no analysis code, and after
// revoking shows the unavailable page.

test.describe.configure({ timeout: 90_000 });

async function analyseAndSave(page: Page): Promise<string> {
  await page.getByRole('button', { name: /Lerato Molefe/ }).click();
  await drawAthleteBox(page);
  await page.getByRole('button', { name: 'Analyse this run' }).click();
  await expect(page).toHaveURL(/\/analyses\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved for your organisation.')).toBeVisible();
  return new URL(page.url()).pathname.split('/').at(-1) ?? '';
}

test('a report is made on the phone, shared signed out, and revoked', async ({
  page,
  api,
  browser,
}) => {
  const athleteId = await importAndCalibrate(page, api);
  const analysisId = await analyseAndSave(page);
  for (const note of ['Relaxed shoulders today.', 'Ask about the sore ankle.']) {
    await page.getByLabel('Add a note').fill(note);
    await page.getByRole('button', { name: 'Add note' }).click();
    await expect(page.getByText(note)).toBeVisible();
  }
  await expect.poll(() => api.notes.size).toBe(2);

  // The builder starts with the three key frames made when the run was analysed.
  await page.getByRole('link', { name: 'Make a report' }).click();
  await expect(page).toHaveURL(new RegExp(`/reports/[0-9a-f-]{36}\\?a=${analysisId}$`));
  await expect(page.getByRole('heading', { name: 'Make a report' })).toBeVisible();
  await expect(page.getByText('3 of 5 chosen')).toBeVisible();
  await page.getByRole('checkbox', { name: /Relaxed shoulders today/ }).check();
  await expectAccessible(page);

  await page.getByRole('button', { name: 'Make the PDF' }).click();
  await expect(page.getByText('The PDF is ready.')).toBeVisible({ timeout: 30_000 });
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download the PDF' }).click();
  const file = await (await download).path();
  expect(readFileSync(file).subarray(0, 5).toString()).toBe('%PDF-');

  // Saved with the athlete: results only, the ticked note only, first name and initial.
  await expect.poll(() => api.reports.size).toBe(1);
  const [reportId, report] = [...api.reports.entries()][0] ?? [];
  if (!reportId || !report) throw new Error('the report was not saved');
  expect(report.snapshot.athleteDisplayName).toBe('Lerato M.');
  expect(report.snapshot.notes.map((n) => n.text)).toEqual(['Relaxed shoulders today.']);
  expect(report.snapshot.frames).toHaveLength(3);
  expect(JSON.stringify(report.snapshot)).not.toContain('Molefe');
  expect(JSON.stringify(report.snapshot)).not.toContain('sore ankle');

  // No sharing consent yet: the API refuses the link, and the screen says why.
  const consentNotice = 'Sharing needs an active sharing consent for this athlete.';
  await expect(page.getByText(consentNotice)).toBeVisible();
  await page.getByRole('button', { name: 'Make a share link' }).click();
  await expect(page.getByRole('alert')).toHaveText(consentNotice);
  expect(api.shares.size).toBe(0);

  // With the consent, from the saved report: the frames go up first, then the link.
  api.grantConsent(athleteId, 'sharing');
  await page.goto(`/reports/${reportId}`);
  await page.getByRole('button', { name: 'Make a share link' }).click();
  const field = page.getByRole('textbox', { name: 'Share link' });
  await expect(field).toHaveValue(/^http:\/\/localhost:4173\/r\/[A-Za-z0-9_-]{43}$/);
  await expect(
    page.getByText('Anyone with this link can see the report until it expires.'),
  ).toBeVisible();
  expect(api.reports.get(reportId)?.frames.size).toBe(3);
  const url = await field.inputValue();

  // Opened in a fresh browser, signed out.
  const context = await browser.newContext();
  const viewer = await context.newPage();
  await api.attach(viewer);
  const requests: string[] = [];
  viewer.on('request', (r) => requests.push(new URL(r.url()).pathname));
  await viewer.goto(url);
  await expect(viewer.getByRole('heading', { name: 'Running technique report' })).toBeVisible();
  await expect(viewer.getByText(/Lerato M\./)).toBeVisible();
  await expect(viewer.getByText('Molefe')).toHaveCount(0);
  await expect(viewer.getByText('Relaxed shoulders today.')).toBeVisible();
  await expect(viewer.getByText('Ask about the sore ankle.')).toHaveCount(0);
  await expect(viewer.getByRole('img', { name: /initial contact/ })).toBeVisible();
  await expect(viewer.getByText(/This report describes movement/)).toBeVisible();
  await expect(
    viewer.getByText(/High confidence|Medium confidence|Low confidence/).first(),
  ).toBeVisible();
  await expectAccessible(viewer);
  expect(await context.cookies()).toEqual([]);
  // None of the app's sign-in, offline or analysis code, and no pose model.
  expect(
    requests.filter((p) => /AppRoot|AppShell|RequireAuth|Analyse|jobRunner|\/models\//.test(p)),
  ).toEqual([]);

  // Revoked: the link answers like one that never existed.
  await page.getByRole('button', { name: 'Revoke the link' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke the link' }).click();
  await expect.poll(() => api.shares.size).toBe(0);
  await viewer.reload();
  await expect(
    viewer.getByRole('heading', { name: 'This link is no longer available.' }),
  ).toBeVisible();
  await viewer.goto('/r/' + 'x'.repeat(43));
  await expect(
    viewer.getByRole('heading', { name: 'This link is no longer available.' }),
  ).toBeVisible();
  await context.close();

  // The athlete's page lists the report, now with no link.
  await page.goto(`/athletes/${athleteId}`);
  const reports = page.getByRole('region', { name: 'Reports' });
  await expect(reports.getByRole('link', { name: /Running technique report/ })).toBeVisible();
  await expect(reports.getByText('No share link')).toBeVisible();
});
