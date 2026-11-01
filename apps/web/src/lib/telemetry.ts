import type { FailCode, GateStatus, Mode } from '@stride/shared/enums';
import type { RouteName } from '@stride/shared/api/routes';
import { config } from './config';
import { isAllowedItem, scrubItem } from './telemetryScrub';

// Browser telemetry (spec: Observability): unhandled errors, failed API calls and three named
// events, sent to Application Insights. No page views, no user or session identifiers, no
// cookies or storage, and every item goes through scrubItem first. Without a connection string
// (local, test and demo builds) every call here does nothing. The SDK is loaded after start-up,
// so it costs the first screen nothing; calls made before it is ready wait in a short queue.

export type PhoneFamily = 'iPhone' | 'iPad' | 'Android' | 'desktop';

export type TelemetryEvent =
  | {
      name: 'analysis_completed';
      mode: Mode;
      gateStatus: GateStatus;
      durationMs: number;
      frameCount: number;
      fps: number;
      phoneFamily: PhoneFamily;
    }
  | { name: 'analysis_failed'; code: FailCode; phoneFamily: PhoneFamily }
  | { name: 'device_check'; result: 'pass' | 'conditional' | 'fail'; phoneFamily: PhoneFamily };

export interface FailedApiCall {
  /** The route's name in the shared registry, never its URL. */
  route: RouteName | 'publicReport';
  method: string;
  /** 0 when the request never got an answer. */
  status: number;
  durationMs: number;
}

/** The part of the SDK this module uses, so that tests can stand in for it. */
export interface TelemetryClient {
  trackEvent(event: { name: string }, properties?: Record<string, unknown>): void;
  trackException(exception: { exception: Error; properties?: Record<string, unknown> }): void;
  trackDependencyData(dependency: {
    id: string;
    name: string;
    target?: string;
    type?: string;
    responseCode: number;
    success?: boolean;
    duration?: number;
    properties?: Record<string, unknown>;
  }): void;
}

const QUEUE_MAX = 50;
let client: TelemetryClient | null = null;
let queue: ((c: TelemetryClient) => void)[] | null = null;

function send(work: (c: TelemetryClient) => void): void {
  if (client) work(client);
  else if (queue && queue.length < QUEUE_MAX) queue.push(work);
}

/** Tests install a client directly (or null to switch telemetry off). */
export function setTelemetryClient(next: TelemetryClient | null): void {
  client = next;
  if (next && queue) for (const work of queue.splice(0)) work(next);
  queue = null;
}

/** A connection string the deploy filled in (the committed .env files hold REPLACE_ME). */
export function usableConnectionString(value: string | undefined): value is string {
  return (
    !!value && /InstrumentationKey=[0-9a-f-]{36}/i.test(value) && !value.includes('REPLACE_ME')
  );
}

export function phoneFamily(userAgent: string): PhoneFamily {
  if (/iPad/.test(userAgent)) return 'iPad';
  if (/iPhone/.test(userAgent)) return 'iPhone';
  if (/Android/.test(userAgent)) return 'Android';
  return 'desktop';
}

export const thisPhoneFamily = (): PhoneFamily =>
  typeof navigator === 'undefined' ? 'desktop' : phoneFamily(navigator.userAgent);

/**
 * Starts the SDK when the build has a connection string. Called once from main.tsx. batchMs is
 * for tests; the SDK's default (15 s, and a flush when the page is hidden) is used otherwise.
 */
export function initTelemetry(
  connectionString = config.appInsightsConnectionString,
  options: { batchMs?: number } = {},
): void {
  if (!usableConnectionString(connectionString) || client || queue) return;
  queue = [];
  void import('@microsoft/applicationinsights-web')
    .then(({ ApplicationInsights }) => {
      const ai = new ApplicationInsights({
        config: {
          connectionString,
          // Failed API calls are reported by the API client itself, by route name.
          disableAjaxTracking: true,
          disableFetchTracking: true,
          enableAutoRouteTracking: false,
          autoTrackPageVisitTime: false,
          disableCookiesUsage: true,
          isStorageUseDisabled: true,
          enableSessionStorageBuffer: false,
          enableUnhandledPromiseRejectionTracking: true,
          disableCorrelationHeaders: true,
          ...(options.batchMs === undefined ? {} : { maxBatchInterval: options.batchMs }),
        },
      });
      ai.loadAppInsights();
      ai.addTelemetryInitializer((item) => {
        const bag = item as unknown as Record<string, unknown>;
        if (!isAllowedItem(bag)) return false;
        item.data = { ...item.data, build: config.buildVersion };
        scrubItem(bag);
        return true;
      });
      setTelemetryClient(ai);
    })
    .catch(() => {
      // Telemetry must never break the app: without the SDK, nothing is sent.
      queue = null;
    });
}

export function trackEvent(event: TelemetryEvent): void {
  const { name, ...properties } = event;
  send((c) => c.trackEvent({ name }, properties));
}

/** An error the app caught (the error boundaries), with the support code the coach can copy. */
export function trackError(error: unknown, supportCode: string): void {
  const exception = error instanceof Error ? error : new Error(String(error));
  send((c) => c.trackException({ exception, properties: { supportCode } }));
}

export function trackFailedApiCall(call: FailedApiCall): void {
  send((c) =>
    c.trackDependencyData({
      id: crypto.randomUUID().replace(/-/g, ''),
      name: `${call.method} ${call.route}`,
      target: 'stride-api',
      type: 'Fetch',
      responseCode: call.status,
      success: false,
      duration: call.durationMs,
    }),
  );
}
