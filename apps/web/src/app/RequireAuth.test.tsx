import { DEV_IDENTITIES } from '@stride/shared/devIdentities';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from './routes';

// The real route table with fake sign-in and a stubbed API.

const [admin, coach] = DEV_IDENTITIES;

function me(role: 'admin' | 'coach') {
  return {
    coach: {
      id: 'ca000000-0000-4000-8000-000000000001',
      email: `${role}@school-a.test`,
      displayName: 'Thandi',
      role,
    },
    organisation: {
      id: 'a0000000-0000-4000-8000-00000000000a',
      name: 'Seeded School A',
      type: 'school',
      maxCoaches: 3,
      clipRetentionDays: 90,
    },
    seatsUsed: 2,
  };
}

function answer(status: number, body: unknown, type = 'application/json') {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } }),
      ),
    ),
  );
}

function signInAs(identity: (typeof DEV_IDENTITIES)[number] | undefined) {
  if (!identity) throw new Error('missing identity');
  localStorage.setItem(
    'stride.fakeIdentity',
    JSON.stringify({ oid: identity.oid, email: identity.email, name: identity.name }),
  );
}

function show(path: string) {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('stride.capabilitiesChecked', 'yes');
  vi.stubGlobal('caches', undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe('RequireAuth', () => {
  it('sends a signed-out visitor to sign-in, remembering the page', async () => {
    show('/athletes');
    expect(await screen.findByRole('heading', { name: 'Local sign-in' })).toBeInTheDocument();
    // Stored by an effect of the sign-in page, which may run just after the first paint.
    await waitFor(() => expect(sessionStorage.getItem('stride.returnTo')).toBe('/athletes'));
  });

  it('shows Home with Settings in the navigation for an administrator', async () => {
    signInAs(admin);
    answer(200, me('admin'));
    show('/');
    expect(await screen.findByRole('heading', { name: 'Hello, Thandi' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
  });

  it('keeps Settings from a coach', async () => {
    signInAs(coach);
    answer(200, me('coach'));
    show('/settings');
    expect(
      await screen.findByText('Only an administrator can open this page.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('explains when the account has not joined an organisation', async () => {
    signInAs(admin);
    answer(
      403,
      { type: 'urn:x', title: 'Not enrolled', status: 403, code: 'not_enrolled' },
      'application/problem+json',
    );
    show('/');
    expect(
      await screen.findByRole('heading', { name: 'Not part of an organisation yet' }),
    ).toBeInTheDocument();
  });

  it('shows the not-found page for an unknown path', async () => {
    show('/no/such/page');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});
