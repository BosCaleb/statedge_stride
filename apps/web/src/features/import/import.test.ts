import { describe, expect, it } from 'vitest';
import { boxFrom } from '../../components/RoiSelector';
import { formatElapsed, overallProgress } from '../../components/JobProgress';
import type { OutboxEntry } from '../../lib/outbox/outbox';
import { mergeQueued, queuedSessions, sessionFromPut } from '../sessions/sessionData';
import { suggestedFps } from './importLogic';

describe('import choices', () => {
  it('offers the file’s own rate for slow motion, and 240 for a re-timed file', () => {
    expect(suggestedFps(239.76)).toBe(240);
    expect(suggestedFps(119.9)).toBe(120);
    expect(suggestedFps(30)).toBe(240);
    expect(suggestedFps(null)).toBe(240);
  });
});

describe('athlete box', () => {
  const frame = { width: 1920, height: 1080 };
  it('works from any two corners and stays inside the frame', () => {
    expect(boxFrom({ x: 400, y: 900 }, { x: 100, y: 300 }, frame)).toEqual({
      x: 100,
      y: 300,
      width: 300,
      height: 600,
    });
    expect(boxFrom({ x: -50, y: 1000 }, { x: 200, y: 1300 }, frame)).toEqual({
      x: 0,
      y: 1000,
      width: 200,
      height: 80,
    });
  });

  it('never makes a box smaller than 16 pixels', () => {
    expect(boxFrom({ x: 1915, y: 10 }, { x: 1916, y: 12 }, frame)).toEqual({
      x: 1904,
      y: 10,
      width: 16,
      height: 16,
    });
  });
});

describe('job progress', () => {
  it('moves forward through the stages', () => {
    const steps = [
      overallProgress('reading', 0),
      overallProgress('finding', 0.1),
      overallProgress('finding', 0.9),
      overallProgress('detecting', 0.5),
      overallProgress('calculating', 1),
    ];
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    expect(steps.at(-1)).toBe(1);
  });

  it('shows elapsed time as minutes and seconds', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(65_400)).toBe('1:05');
  });
});

describe('sessions written offline', () => {
  const coach = '9c1f8f3c-2d6e-4b7a-a0f4-3e5a9d1c7b22';
  const entry = (id: string, body: unknown, createdAt: number): OutboxEntry => ({
    id: `${id}-${createdAt}`,
    createdAt,
    route: 'putSession',
    params: { id },
    body,
    dependsOn: [],
    resource: { type: 'session', id },
    label: 'Session',
    state: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
  });
  const a = '1a1f8f3c-2d6e-4b7a-a0f4-3e5a9d1c7b22';
  const b = '2b1f8f3c-2d6e-4b7a-a0f4-3e5a9d1c7b22';

  it('are read from the outbox, the latest write winning', () => {
    const queued = queuedSessions(
      [
        entry(a, { sessionDate: '2026-03-01', mode: 'sprint' }, 1000),
        entry(a, { sessionDate: '2026-03-02', mode: 'sprint', place: 'Track' }, 2000),
        entry(b, { sessionDate: 'not a date', mode: 'sprint' }, 3000),
      ],
      coach,
    );
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      id: a,
      sessionDate: '2026-03-02',
      place: 'Track',
      createdAt: new Date(1000).toISOString(),
    });
  });

  it('are laid over the server list, newest date first', () => {
    const server = [
      sessionFromPut(
        b,
        { sessionDate: '2026-03-05', mode: 'distance' },
        coach,
        '2026-03-05T08:00:00.000Z',
      ),
    ];
    const merged = mergeQueued(server, [
      sessionFromPut(
        a,
        { sessionDate: '2026-03-07', mode: 'sprint' },
        coach,
        '2026-03-07T08:00:00.000Z',
      ),
      sessionFromPut(
        b,
        { sessionDate: '2026-03-05', mode: 'sprint' },
        coach,
        '2026-03-09T08:00:00.000Z',
      ),
    ]);
    expect(merged.map((s) => s.id)).toEqual([a, b]);
    // A queued edit keeps the server's creation time.
    expect(merged[1]).toMatchObject({ mode: 'sprint', createdAt: '2026-03-05T08:00:00.000Z' });
  });
});
