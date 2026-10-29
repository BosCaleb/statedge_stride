import type { Page, TestInfo } from '@playwright/test';
import { expect, PEOPLE, signIn, test } from './fixtures';
import { API_ORIGIN } from './stubApi';

function requestGate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
  await info.attach(name, { path, contentType: 'image/png' });
}

test.describe('StatEdge loading and branding', () => {
  test('plays the StatEdge intro during a slow startup', async ({ page, api }, info) => {
    void api;
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const entry = requestGate();
    await page.route(/\/assets\/index-[^/]+\.js(?:\?.*)?$/, async (route) => {
      await entry.promise;
      await route.continue();
    });
    try {
      await page.goto('/signin', { waitUntil: 'commit' });
      const loader = page.locator('.se-loader--screen');
      await expect(loader).toBeVisible();
      await expect(loader.locator('.se-logo')).toHaveCSS('animation-name', 'se-logo-reveal');
      await loader.evaluate((element) => {
        for (const animation of element.getAnimations({ subtree: true })) {
          animation.pause();
          animation.currentTime = 4500;
        }
      });
      await expect(loader.locator('.se-logo')).toHaveCSS('opacity', '1');
      await expect(loader.locator('.se-rings')).toHaveCSS('opacity', '0');
      await capture(page, info, 'startup-animation-finished');
    } finally {
      entry.release();
    }
    await expect(page.getByRole('heading', { name: 'Local sign-in' })).toBeVisible();
    await expect(page.locator('.se-loader--screen')).toHaveCount(0);
  });

  test('shows loading while sign-in redirects to the app', async ({ page, api }) => {
    void api;
    await page.goto('/signin');
    const shell = requestGate();
    await page.route(/\/assets\/AppShell-[^/]+\.js(?:\?.*)?$/, async (route) => {
      await shell.promise;
      await route.continue();
    });
    try {
      await page.getByRole('button', { name: `Sign in as ${PEOPLE.coachA.email}` }).click();
      await expect(page.locator('.se-loader--screen')).toBeVisible();
    } finally {
      shell.release();
    }
    await expect(page.getByRole('heading', { name: 'Hello, Sipho Coach' })).toBeVisible();
    await expect(page.locator('.se-loader--screen')).toHaveCount(0);
  });

  test('shows the startup mark before JavaScript, with a static reduced-motion presentation', async ({
    page,
    api,
  }, info) => {
    void api;
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
    const entry = requestGate();
    await page.route(/\/assets\/index-[^/]+\.js(?:\?.*)?$/, async (route) => {
      await entry.promise;
      await route.continue();
    });

    try {
      await page.goto('/signin', { waitUntil: 'commit' });
      const loader = page.locator('#root .se-loader--screen');
      await expect(loader).toBeVisible();
      await expect(loader).toHaveAttribute('role', 'status');
      await expect(loader).toHaveAttribute('aria-label', 'Loading StatEdge Stride');
      await expect(loader.locator('.se-logo')).toHaveCSS('opacity', '1');
      await expect(loader.locator('.se-logo svg')).toBeVisible();
      const motion = await loader.locator('.se-logo').evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          durations: style.animationDuration.split(',').map((value) => Number.parseFloat(value)),
          delays: style.animationDelay.split(',').map((value) => Number.parseFloat(value)),
        };
      });
      expect(motion.durations.every((duration) => duration <= 0.01)).toBe(true);
      expect(motion.delays.every((delay) => delay === 0)).toBe(true);
      await capture(page, info, 'startup-reduced-motion');
    } finally {
      entry.release();
    }

    await expect(page.getByRole('heading', { name: 'Local sign-in' })).toBeVisible();
    await expect(page.locator('.se-loader--screen')).toHaveCount(0);
    await expect(page.getByRole('img', { name: 'StatEdge Stride' })).toBeVisible();
    await capture(page, info, 'signin-light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.getByRole('img', { name: 'StatEdge Stride' })).toBeVisible();
    await capture(page, info, 'signin-dark');
  });

  test('keeps navigation available while a page chunk loads', async ({ page, api }, info) => {
    void api;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signIn(page, PEOPLE.coachA);
    await expect(page.getByRole('heading', { name: 'Hello, Sipho Coach' })).toBeVisible();
    const originalHeading = await page
      .getByRole('heading', { name: 'Hello, Sipho Coach' })
      .elementHandle();
    await capture(page, info, 'header');

    const guide = requestGate();
    await page.route(/\/assets\/GuidePage-[^/]+\.js(?:\?.*)?$/, async (route) => {
      await guide.promise;
      await route.continue();
    });
    const navigation = page.getByRole('navigation', { name: 'Main' });
    try {
      await navigation.getByRole('link', { name: 'Guide' }).click();
      await expect(page.locator('main .se-loader--page')).toBeVisible();
      await expect(navigation).toBeVisible();
      await expect(page.getByRole('link', { name: 'StatEdge Stride', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Hello, Sipho Coach' })).toBeHidden();
      expect(await originalHeading?.evaluate((element) => element.isConnected)).toBe(true);
      await capture(page, info, 'page-transition');
      // Cancelling a pending route keeps the existing screen, rather than remounting it.
      await navigation.getByRole('link', { name: 'Home', exact: true }).click();
      await expect(page.locator('.se-loader--page')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Hello, Sipho Coach' })).toBeVisible();
      expect(await originalHeading?.evaluate((element) => element.isConnected)).toBe(true);
      await navigation.getByRole('link', { name: 'Guide' }).click();
      await expect(page.locator('main .se-loader--page')).toBeVisible();
    } finally {
      guide.release();
    }
    await expect(page.getByRole('heading', { name: 'Capture guide' })).toBeVisible();
    await expect(page.locator('.se-loader--page')).toHaveCount(0);
  });

  test('uses the branded inline loader until page data arrives', async ({ page, api }, info) => {
    void api;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signIn(page, PEOPLE.coachA);
    await expect(page.getByRole('heading', { name: 'Hello, Sipho Coach' })).toBeVisible();

    const athletes = requestGate();
    await page.route(`${API_ORIGIN}/api/v1/athletes*`, async (route) => {
      await athletes.promise;
      await route.fallback();
    });
    try {
      await page
        .getByRole('navigation', { name: 'Main' })
        .getByRole('link', { name: 'Athletes' })
        .click();
      await expect(page.getByRole('heading', { name: 'Athletes', exact: true })).toBeVisible();
      await expect(page.locator('main .se-loader--inline')).toBeVisible();
      await expect(page.locator('main .se-loader--inline')).toHaveAttribute('role', 'status');
      await capture(page, info, 'page-data-loading');
    } finally {
      athletes.release();
    }
    await expect(page.getByRole('heading', { name: 'No athletes yet' })).toBeVisible();
    await expect(page.locator('main .se-loader--inline')).toHaveCount(0);
    expect(api.calls).toContain('GET /v1/athletes');
  });
});
