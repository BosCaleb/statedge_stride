import { randomUUID } from 'node:crypto';
import type { Page, Route } from '@playwright/test';
import type { Athlete, Consent } from '@stride/shared/api/athletes';
import type { DeviceCheckPost } from '@stride/shared/api/devices';
import type { AuditEntry, Member } from '@stride/shared/api/org';
import type { Session } from '@stride/shared/api/sessions';
import {
  routeEntries,
  type ROUTES,
  type RouteDef,
  type RouteName,
} from '@stride/shared/api/routes';
import { consentRuleProblem } from '@stride/shared/consent';
import { DEV_IDENTITIES, DEV_ORGS } from '@stride/shared/devIdentities';
import type { AuditAction } from '@stride/shared/enums';
import type { z } from 'zod';

// An in-memory stand-in for the API, enough for the flows under test. Every request body is
// parsed with the shared route schemas, so a contract mismatch fails the test. It reads the
// fake token the web app sends, so each test acts as a seeded person.

export const API_ORIGIN = 'https://api.stride.test';
const WEB_ORIGIN = 'http://localhost:4173';

type Person = (typeof DEV_IDENTITIES)[number];
type OrgKey = keyof typeof DEV_ORGS;
interface Reply {
  status?: number;
  body?: unknown;
}
class Problem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

interface Invite {
  id: string;
  org: OrgKey;
  email: string;
  role: 'admin' | 'coach';
  token: string;
  expiresAt: string;
  createdAt: string;
  acceptedBy: string | null;
}

interface Call {
  person: Person | null;
  org: OrgKey | null;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
}

export class StubApi {
  /** Requests seen, as "METHOD /v1/path". */
  readonly calls: string[] = [];
  readonly athletes = new Map<string, Athlete & { org: OrgKey }>();
  readonly consents = new Map<string, Consent & { org: OrgKey }>();
  readonly invites: Invite[] = [];
  readonly coaches: (Member & { org: OrgKey; oid: string })[] = [];
  readonly audit: (AuditEntry & { org: OrgKey })[] = [];
  readonly sessions = new Map<string, Session & { org: OrgKey }>();
  readonly deviceChecks = new Map<string, DeviceCheckPost & { org: OrgKey; createdAt: string }>();
  private failures: { route: RouteName; status: number; code: string }[] = [];
  /** Route interception runs before the network, so going offline must be simulated here too. */
  offline = false;
  private retention: Record<OrgKey, number> = { a: 90, b: 90 };

  constructor() {
    for (const p of DEV_IDENTITIES) {
      if (!p.coach) continue;
      this.coaches.push({
        id: p.coach.id,
        org: p.coach.org,
        oid: p.oid,
        email: p.email,
        displayName: p.name,
        role: p.coach.role,
        status: 'active',
        createdAt: '2026-01-01T08:00:00.000Z',
        lastSeenAt: null,
      });
    }
  }

  async attach(page: Page): Promise<void> {
    await page.route(`${API_ORIGIN}/api/**`, (route) => this.handle(route));
  }

  /** Adds an athlete to an organisation, with an adult's verbal consent for analysis. */
  seedAthlete(
    org: OrgKey,
    athlete: { firstName: string; lastName: string; birthYear: number },
    consent = true,
  ): string {
    const id = randomUUID();
    this.athletes.set(id, {
      id,
      org,
      ...athlete,
      externalRef: null,
      createdAt: new Date().toISOString(),
      consents: { analysis: null, sharing: null, clip_storage: null },
    });
    if (consent) {
      const consentId = randomUUID();
      this.consents.set(consentId, {
        id: consentId,
        org,
        athleteId: id,
        purpose: 'analysis',
        givenBy: 'athlete',
        givenByName: `${athlete.firstName} ${athlete.lastName}`,
        relationship: null,
        evidence: 'verbal',
        givenOn: '2026-03-01',
        recordedBy: this.coaches.find((c) => c.org === org)?.id ?? '',
        recordedAt: new Date().toISOString(),
        withdrawnAt: null,
      });
    }
    return id;
  }

  /** The next request to this route answers with a problem instead. */
  failNext(route: RouteName, status: number, code: string): void {
    this.failures.push({ route, status, code });
  }

  private async handle(route: Route): Promise<void> {
    if (this.offline) {
      await route.abort('internetdisconnected');
      return;
    }
    const request = route.request();
    const cors = { 'Access-Control-Allow-Origin': WEB_ORIGIN, Vary: 'Origin' };
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
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, '');
    this.calls.push(`${request.method()} ${path}`);
    const match = this.match(request.method(), path);
    let status: number;
    let body: unknown;
    try {
      if (!match) throw new Problem(404, 'not_found');
      const [name, def, params] = match;
      const failure = this.failures.findIndex((f) => f.route === name);
      if (failure >= 0) {
        const [f] = this.failures.splice(failure, 1);
        if (f) throw new Problem(f.status, f.code);
      }
      const person = this.person(request.headers().authorization);
      if (def.auth !== 'none' && !person) throw new Problem(401, 'unauthorised');
      const coach = person?.coach ? this.coaches.find((c) => c.oid === person.oid) : undefined;
      if ((def.auth === 'coach' || def.auth === 'admin') && !coach)
        throw new Problem(403, 'not_enrolled');
      if (coach?.status === 'removed') throw new Problem(403, 'forbidden');
      if (def.auth === 'admin' && coach?.role !== 'admin') throw new Problem(403, 'forbidden');
      let parsedBody: unknown;
      if (def.body && !('kind' in def.body)) {
        const parsed = def.body.safeParse(request.postDataJSON());
        if (!parsed.success) throw new Problem(400, 'validation');
        parsedBody = parsed.data;
      }
      const reply = this.reply(name, {
        person,
        org: coach?.org ?? null,
        params,
        query: url.searchParams,
        body: parsedBody,
      });
      status = reply.status ?? (def.response === null ? 204 : 200);
      body = reply.body;
    } catch (error) {
      if (!(error instanceof Problem)) throw error;
      status = error.status;
      body = { type: 'urn:test', title: error.code, status: error.status, code: error.code };
    }
    await route.fulfill({
      status,
      headers: {
        ...cors,
        'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json',
      },
      ...(status === 204 ? {} : { body: JSON.stringify(body) }),
    });
  }

  private match(
    method: string,
    path: string,
  ): [RouteName, RouteDef, Record<string, string>] | null {
    for (const [name, def] of routeEntries()) {
      if (def.method !== method) continue;
      const pattern = new RegExp(`^${def.path.replace(/\{(\w+)\}/g, '(?<$1>[^/]+)')}$`);
      const m = pattern.exec(path);
      if (m) return [name, def, { ...m.groups }];
    }
    return null;
  }

  private person(header: string | undefined): Person | null {
    const token = header?.replace(/^Bearer fake\./, '');
    if (!token) return null;
    const json = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as { oid: string };
    return DEV_IDENTITIES.find((p) => p.oid === json.oid) ?? null;
  }

  private record(
    org: OrgKey,
    coachId: string | null,
    action: AuditAction,
    targetId: string | null,
  ): void {
    this.audit.unshift({
      id: String(this.audit.length + 1),
      org,
      action,
      coachId,
      targetType: action.split('.')[0] ?? null,
      targetId,
      detail: null,
      at: new Date().toISOString(),
    });
  }

  private summary(athleteId: string) {
    const active = [...this.consents.values()].filter(
      (c) => c.athleteId === athleteId && c.withdrawnAt === null,
    );
    const pick = (p: string) => {
      const c = active.find((x) => x.purpose === p);
      if (!c) return null;
      const { org: _org, ...consent } = c;
      return consent;
    };
    return {
      analysis: pick('analysis'),
      sharing: pick('sharing'),
      clip_storage: pick('clip_storage'),
    };
  }

  private athleteOut(id: string): Athlete {
    const a = this.athletes.get(id);
    if (!a) throw new Problem(404, 'not_found');
    const { org: _org, ...rest } = a;
    return { ...rest, consents: this.summary(id) };
  }

  private me(person: Person, org: OrgKey) {
    const coach = this.coaches.find((c) => c.oid === person.oid);
    const o = DEV_ORGS[org];
    return {
      coach: {
        id: coach?.id ?? '',
        email: person.email,
        displayName: person.name,
        role: coach?.role ?? 'coach',
      },
      organisation: {
        id: o.id,
        name: o.name,
        type: o.type,
        maxCoaches: o.maxCoaches,
        clipRetentionDays: this.retention[org],
      },
      seatsUsed: this.seatsUsed(org),
    };
  }

  private seatsUsed(org: OrgKey): number {
    const now = Date.now();
    const pending = this.invites.filter(
      (i) => i.org === org && !i.acceptedBy && Date.parse(i.expiresAt) > now,
    );
    return (
      this.coaches.filter((c) => c.org === org && c.status === 'active').length + pending.length
    );
  }

  private reply(name: RouteName, c: Call): Reply {
    const org = c.org;
    const coachId = c.person?.coach?.id ?? null;
    const inOrg = (id: string) => {
      const a = this.athletes.get(id);
      if (!a || a.org !== org) throw new Problem(404, 'not_found');
      return a;
    };
    switch (name) {
      case 'health':
        return { body: { status: 'ok', version: 'e2e' } };
      case 'me':
        if (!c.person || !org) throw new Problem(403, 'not_enrolled');
        return { body: this.me(c.person, org) };
      case 'listAthletes': {
        const items = [...this.athletes.keys()]
          .filter((id) => this.athletes.get(id)?.org === org)
          .map((id) => this.athleteOut(id));
        return { body: { items, nextCursor: null } };
      }
      case 'putAthlete': {
        const body = c.body as z.output<typeof ROUTES.putAthlete.body>;
        const existing = this.athletes.get(c.params.id ?? '');
        if (existing && existing.org !== org) throw new Problem(409, 'conflict');
        const id = c.params.id ?? '';
        this.athletes.set(id, {
          id,
          org: org ?? 'a',
          firstName: body.firstName,
          lastName: body.lastName,
          birthYear: body.birthYear,
          externalRef: body.externalRef ?? null,
          createdAt: existing?.createdAt ?? new Date().toISOString(),
          consents: { analysis: null, sharing: null, clip_storage: null },
        });
        if (!existing) this.record(org ?? 'a', coachId, 'athlete.create', id);
        return { status: existing ? 200 : 201, body: this.athleteOut(id) };
      }
      case 'getAthlete':
        inOrg(c.params.id ?? '');
        return { body: this.athleteOut(c.params.id ?? '') };
      case 'deleteAthlete': {
        const a = inOrg(c.params.id ?? '');
        const typed = (c.body as { confirmName: string }).confirmName.trim().toLowerCase();
        if (typed !== `${a.firstName} ${a.lastName}`.toLowerCase())
          throw new Problem(400, 'validation');
        this.athletes.delete(a.id);
        for (const [id, consent] of this.consents)
          if (consent.athleteId === a.id) this.consents.delete(id);
        this.record(a.org, coachId, 'athlete.delete', a.id);
        return {};
      }
      case 'listConsents': {
        inOrg(c.params.id ?? '');
        const items = [...this.consents.values()]
          .filter((x) => x.athleteId === c.params.id)
          .map(({ org: _o, ...x }) => x);
        return { body: { items } };
      }
      case 'putConsent': {
        const body = c.body as z.output<typeof ROUTES.putConsent.body>;
        const a = inOrg(body.athleteId);
        const id = c.params.id ?? '';
        if (this.consents.has(id)) return { body: this.consents.get(id) };
        if (
          consentRuleProblem(a.birthYear, new Date().getUTCFullYear(), body.givenBy, body.evidence)
        )
          throw new Problem(400, 'validation');
        if (this.summary(a.id)[body.purpose]) throw new Problem(409, 'conflict');
        const consent = {
          id,
          org: a.org,
          athleteId: a.id,
          purpose: body.purpose,
          givenBy: body.givenBy,
          givenByName: body.givenByName,
          relationship: body.relationship ?? null,
          evidence: body.evidence,
          givenOn: body.givenOn,
          recordedBy: coachId ?? '',
          recordedAt: new Date().toISOString(),
          withdrawnAt: null,
        };
        this.consents.set(id, consent);
        this.record(a.org, coachId, 'consent.record', id);
        const { org: _o, ...out } = consent;
        return { status: 201, body: out };
      }
      case 'withdrawConsent': {
        const consent = this.consents.get(c.params.id ?? '');
        if (!consent || consent.org !== org) throw new Problem(404, 'not_found');
        consent.withdrawnAt ??= new Date().toISOString();
        this.record(consent.org, coachId, 'consent.withdraw', consent.id);
        const { org: _o, ...out } = consent;
        return { body: out };
      }
      case 'listMembers': {
        const now = Date.now();
        return {
          body: {
            items: this.coaches
              .filter((x) => x.org === org)
              .map(({ org: _o, oid: _oid, ...m }) => m),
            pendingInvites: this.invites
              .filter((i) => i.org === org && !i.acceptedBy && Date.parse(i.expiresAt) > now)
              .map((i) => ({
                id: i.id,
                email: i.email,
                role: i.role,
                expiresAt: i.expiresAt,
                createdAt: i.createdAt,
              })),
            maxCoaches: org ? DEV_ORGS[org].maxCoaches : 0,
            seatsUsed: org ? this.seatsUsed(org) : 0,
          },
        };
      }
      case 'createInvite': {
        const body = c.body as { email: string; role: 'admin' | 'coach' };
        if (!org) throw new Problem(403, 'forbidden');
        if (this.seatsUsed(org) >= DEV_ORGS[org].maxCoaches) throw new Problem(422, 'seat_limit');
        const token = Buffer.from(randomUUID() + randomUUID())
          .toString('base64url')
          .slice(0, 43);
        const invite: Invite = {
          id: randomUUID(),
          org,
          email: body.email.toLowerCase(),
          role: body.role,
          token,
          expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
          createdAt: new Date().toISOString(),
          acceptedBy: null,
        };
        this.invites.push(invite);
        this.record(org, coachId, 'member.invite', invite.id);
        return {
          status: 201,
          body: {
            id: invite.id,
            url: `${WEB_ORIGIN}/invite/${token}`,
            expiresAt: invite.expiresAt,
          },
        };
      }
      case 'revokeInvite': {
        const i = this.invites.findIndex(
          (x) => x.id === c.params.id && x.org === org && !x.acceptedBy,
        );
        if (i < 0) throw new Problem(404, 'not_found');
        this.invites.splice(i, 1);
        return {};
      }
      case 'removeMember': {
        const coach = this.coaches.find(
          (x) => x.id === c.params.coachId && x.org === org && x.status === 'active',
        );
        if (!coach) throw new Problem(404, 'not_found');
        coach.status = 'removed';
        this.record(coach.org, coachId, 'member.remove', coach.id);
        return {};
      }
      case 'patchOrg': {
        if (!org) throw new Problem(403, 'forbidden');
        this.retention[org] = (c.body as { clipRetentionDays: number }).clipRetentionDays;
        return { body: this.me(c.person as Person, org).organisation };
      }
      case 'listAudit':
        return {
          body: {
            items: this.audit.filter((e) => e.org === org).map(({ org: _o, ...e }) => e),
            nextCursor: null,
          },
        };
      case 'acceptInvite': {
        const token = (c.body as { token: string }).token;
        const invite = this.invites.find((i) => i.token === token);
        if (!invite || Date.parse(invite.expiresAt) < Date.now())
          throw new Problem(404, 'not_found');
        if (!c.person || invite.email !== c.person.email) throw new Problem(403, 'forbidden');
        if (invite.acceptedBy && invite.acceptedBy !== c.person.oid)
          throw new Problem(409, 'conflict');
        if (!this.coaches.some((x) => x.oid === c.person?.oid)) {
          this.coaches.push({
            id: randomUUID(),
            org: invite.org,
            oid: c.person.oid,
            email: c.person.email,
            displayName: c.person.name,
            role: invite.role,
            status: 'active',
            createdAt: new Date().toISOString(),
            lastSeenAt: null,
          });
        }
        invite.acceptedBy = c.person.oid;
        return { body: this.me(c.person, invite.org) };
      }
      case 'listSessions': {
        const items = [...this.sessions.values()]
          .filter((x) => x.org === org)
          .sort(
            (x, y) =>
              y.sessionDate.localeCompare(x.sessionDate) || y.createdAt.localeCompare(x.createdAt),
          )
          .map(({ org: _o, ...x }) => x);
        return { body: { items, nextCursor: null } };
      }
      case 'putSession': {
        const body = c.body as z.output<typeof ROUTES.putSession.body>;
        const id = c.params.id ?? '';
        const existing = this.sessions.get(id);
        if (existing && existing.org !== org) throw new Problem(409, 'conflict');
        const session = {
          id,
          org: org ?? 'a',
          sessionDate: body.sessionDate,
          place: body.place ?? null,
          surface: body.surface ?? null,
          footwear: body.footwear ?? null,
          mode: body.mode,
          notes: body.notes ?? null,
          createdBy: existing?.createdBy ?? coachId ?? '',
          createdAt: existing?.createdAt ?? new Date().toISOString(),
        };
        this.sessions.set(id, session);
        const { org: _o, ...out } = session;
        return { status: existing ? 200 : 201, body: out };
      }
      case 'getSession': {
        const session = this.sessions.get(c.params.id ?? '');
        if (!session || session.org !== org) throw new Problem(404, 'not_found');
        const { org: _o, ...out } = session;
        return { body: { session: out, calibrations: [], clips: [], analyses: [] } };
      }
      case 'postDeviceCheck': {
        const body = c.body as DeviceCheckPost;
        const existing = this.deviceChecks.get(body.id);
        if (existing && existing.org !== org) throw new Problem(409, 'conflict');
        const createdAt = existing?.createdAt ?? new Date().toISOString();
        if (!existing) this.deviceChecks.set(body.id, { ...body, org: org ?? 'a', createdAt });
        return { status: existing ? 200 : 201, body: { id: body.id, createdAt } };
      }
      case 'deviceProfiles':
        return {
          body: {
            items: [
              {
                model: 'Samsung Galaxy S23 Ultra',
                tier: 'A',
                maxSlowmo: '1080p at 240 fps',
                notes: null,
                updatedAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          },
        };
      default:
        throw new Problem(404, 'not_found');
    }
  }
}
