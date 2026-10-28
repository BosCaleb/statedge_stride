import type { Page, Route } from '@playwright/test';
import { DEV_IDENTITIES, DEV_ORGS } from '@stride/shared/devIdentities';

// A small in-memory stand-in for the API, enough for the flows under test. It reads the fake
// token the web app sends, so each test acts as a seeded person.

export const API_ORIGIN = 'https://api.stride.test';

interface Problem {
  status: number;
  code: string;
}

export class StubApi {
  /** Requests seen, as "METHOD /v1/path". */
  readonly calls: string[] = [];

  async attach(page: Page): Promise<void> {
    await page.route(`${API_ORIGIN}/api/**`, (route) => this.handle(route));
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, '');
    const cors = { 'Access-Control-Allow-Origin': 'http://localhost:4173', Vary: 'Origin' };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          ...cors,
          'Access-Control-Allow-Methods': 'GET, PUT, POST, PATCH, DELETE',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        },
      });
      return;
    }
    this.calls.push(`${request.method()} ${path}`);
    const person = this.person(request.headers().authorization);
    const reply = this.reply(request.method(), path, person);
    const body =
      'problem' in reply
        ? { type: 'urn:test', title: reply.problem.code, ...reply.problem }
        : reply.body;
    await route.fulfill({
      status: 'problem' in reply ? reply.problem.status : (reply.status ?? 200),
      headers: {
        ...cors,
        'Content-Type': 'problem' in reply ? 'application/problem+json' : 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  private person(header: string | undefined) {
    const token = header?.replace(/^Bearer fake\./, '');
    if (!token) return null;
    const json = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as { oid: string };
    return DEV_IDENTITIES.find((p) => p.oid === json.oid) ?? null;
  }

  private reply(
    method: string,
    path: string,
    person: (typeof DEV_IDENTITIES)[number] | null,
  ): { status?: number; body: unknown } | { problem: Problem } {
    if (method === 'GET' && path === '/v1/health')
      return { body: { status: 'ok', version: 'e2e' } };
    if (!person) return { problem: { status: 401, code: 'unauthorised' } };
    if (!person.coach) return { problem: { status: 403, code: 'not_enrolled' } };
    const org = DEV_ORGS[person.coach.org];
    if (method === 'GET' && path === '/v1/me') {
      return {
        body: {
          coach: {
            id: person.coach.id,
            email: person.email,
            displayName: person.name,
            role: person.coach.role,
          },
          organisation: {
            id: org.id,
            name: org.name,
            type: org.type,
            maxCoaches: org.maxCoaches,
            clipRetentionDays: 90,
          },
          seatsUsed: 2,
        },
      };
    }
    return { problem: { status: 404, code: 'not_found' } };
  }
}
