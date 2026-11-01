import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { strings } from '../lib/strings';
import { setTelemetryClient, type TelemetryClient } from '../lib/telemetry';
import { AppErrorBoundary, RouteError } from './ErrorBoundary';

// Both error boundaries send the error to telemetry with the support code the coach can copy,
// and the same code goes to the console.

function Boom(): never {
  throw new Error('render failed');
}

function capture() {
  const trackException = vi.fn<TelemetryClient['trackException']>();
  setTelemetryClient({ trackEvent: vi.fn(), trackException, trackDependencyData: vi.fn() });
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  // React rethrows render errors to window in development; keep them out of the test output.
  window.addEventListener('error', quiet);
  return { trackException, consoleError };
}

const loggedCodes = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls
    .map((c) => (typeof c[0] === 'string' ? /^support code (\S+)/.exec(c[0])?.[1] : undefined))
    .filter((c): c is string => c !== undefined);

const quiet = (e: ErrorEvent) => e.preventDefault();

afterEach(() => {
  window.removeEventListener('error', quiet);
  setTelemetryClient(null);
  vi.restoreAllMocks();
});

describe('error boundaries', () => {
  it('the outer boundary sends the error with its support code', () => {
    const { trackException, consoleError } = capture();
    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(strings.errors.title);
    const sent = trackException.mock.calls.at(-1)?.[0];
    expect(sent?.exception.message).toBe('render failed');
    const code = String(sent?.properties?.supportCode);
    expect(code).toMatch(/^\S+-\d{8}T\d{4}-[0-9A-Z]{1,4}$/);
    expect(loggedCodes(consoleError)).toContain(code);
  });

  it("the router's error element sends it too, but not for an unknown page", () => {
    const { trackException, consoleError } = capture();
    const routes = [{ path: '/', element: <Boom />, errorElement: <RouteError /> }];
    render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/'] })} />);
    const sent = trackException.mock.calls.at(-1)?.[0];
    expect(sent?.exception.message).toBe('render failed');
    expect(loggedCodes(consoleError)).toContain(String(sent?.properties?.supportCode));

    trackException.mockClear();
    render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/nope'] })} />);
    expect(screen.getByText(strings.errors.notFoundTitle)).toBeInTheDocument();
    expect(trackException).not.toHaveBeenCalled();
  });
});
