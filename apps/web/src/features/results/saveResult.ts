import type { Athlete } from '@stride/shared/api/athletes';
import type { CalibrationPut, ClipPut } from '@stride/shared/api/sessions';
import { shortDisplayName } from '@stride/shared/reportSnapshot';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { storeLocalClips, storeLocalResult } from '../../lib/local/localQueries';
import type { LocalCalibration, LocalClip, LocalResult } from '../../lib/local/records';
import { useOutbox } from '../../lib/outbox/OutboxProvider';
import { strings } from '../../lib/strings';

// Saving a result: everything it depends on goes through the outbox in order, each write
// waiting for the ones before it (session, calibration, clip, analysis, keypoints, note). Every
// write is an idempotent PUT with the phone's own id, so a repeat after a lost answer is safe.

export function calibrationPut(cal: LocalCalibration): CalibrationPut {
  return {
    sessionId: cal.sessionId,
    distanceM: cal.distanceM,
    markerA: cal.markerA,
    markerB: cal.markerB,
    pxPerM: cal.pxPerM,
    frameWidth: cal.frameWidth,
    frameHeight: cal.frameHeight,
  };
}

export function clipPut(
  clip: LocalClip,
  sent: { calibrationId: string | null; direction: 1 | -1 | null },
): ClipPut {
  return {
    sessionId: clip.sessionId,
    athleteId: clip.athleteId,
    role: clip.role,
    calibrationId: sent.calibrationId,
    deviceModel: null,
    declaredFps: clip.declaredFps,
    detectedFps: clip.detectedFps,
    widthPx: clip.widthPx,
    heightPx: clip.heightPx,
    frameCount: clip.frameCount,
    durationSec: clip.durationSec,
    codec: clip.codec.slice(0, 30),
    direction: sent.direction,
    fingerprint: clip.fingerprint,
  };
}

/** The result's outbox writes, in the order they must succeed. */
export interface SaveInput {
  record: LocalResult;
  clip: LocalClip;
  calibration: LocalCalibration | null;
  athlete: Athlete;
  /** A saved analysis of the same clip that this one replaces. */
  supersedes: string | null;
}

export const historyKey = (athleteId: string) => ['history', athleteId] as const;
export const analysisKey = (id: string) => ['analysis', id] as const;

export function useSaveResult() {
  const outbox = useOutbox();
  const queryClient = useQueryClient();
  return useCallback(
    async ({ record, clip, calibration, athlete, supersedes }: SaveInput) => {
      const label = strings.results.outboxLabel(
        shortDisplayName(athlete.firstName, athlete.lastName),
      );
      const session = { type: 'session', id: record.sessionId };
      const athleteRef = { type: 'athlete', id: record.athleteId };
      // The clip is immutable on the server: a later save sends what the first one did.
      const sent = clip.sent ?? {
        calibrationId: record.calibrationId,
        direction: record.result.direction,
      };
      const cal = sent.calibrationId === calibration?.id ? calibration : null;
      if (cal) {
        await outbox.enqueue({
          route: 'putCalibration',
          params: { id: cal.id },
          body: calibrationPut(cal),
          resource: { type: 'calibration', id: cal.id },
          needs: [session],
          label,
        });
      }
      await outbox.enqueue({
        route: 'putClip',
        params: { id: clip.id },
        body: clipPut(clip, sent),
        resource: { type: 'clip', id: clip.id },
        needs: [session, athleteRef, ...(cal ? [{ type: 'calibration', id: cal.id }] : [])],
        label,
      });
      await outbox.enqueue({
        route: 'putAnalysis',
        params: { id: record.id },
        body: {
          clipId: clip.id,
          athleteId: record.athleteId,
          result: record.result,
          ...(supersedes ? { supersedes } : {}),
        },
        resource: { type: 'analysis', id: record.id },
        needs: [
          { type: 'clip', id: clip.id },
          athleteRef,
          ...(supersedes ? [{ type: 'analysis', id: supersedes }] : []),
        ],
        label,
        invalidates: [
          [...historyKey(record.athleteId)],
          [...analysisKey(record.id)],
          ['session', record.sessionId],
        ],
      });
      await outbox.enqueue({
        route: 'putKeypoints',
        params: { id: record.id },
        body: record.keypoints,
        resource: { type: 'keypoints', id: record.id },
        needs: [{ type: 'analysis', id: record.id }],
        label,
      });
      const note = record.noteDraft.trim().slice(0, 2000);
      const noteId = record.noteId ?? (note ? crypto.randomUUID() : null);
      if (note && noteId) {
        await outbox.enqueue({
          route: 'putNote',
          params: { id: noteId },
          body: { analysisId: record.id, body: note },
          resource: { type: 'note', id: noteId },
          needs: [{ type: 'analysis', id: record.id }],
          label,
          invalidates: [[...analysisKey(record.id)]],
        });
      }
      if (!clip.sent) await storeLocalClips(queryClient, [{ ...clip, sent }]);
      await storeLocalResult(queryClient, {
        ...record,
        noteId,
        savedAt: new Date().toISOString(),
      });
      void outbox.flush();
    },
    [outbox, queryClient],
  );
}

/** Notes on a saved analysis: written through the outbox, last write wins. */
export function useSaveNote() {
  const outbox = useOutbox();
  return useCallback(
    async (analysisId: string, noteId: string, body: string, label: string) => {
      await outbox.enqueue({
        route: 'putNote',
        params: { id: noteId },
        body: { analysisId, body: body.trim().slice(0, 2000) },
        resource: { type: 'note', id: noteId },
        needs: [{ type: 'analysis', id: analysisId }],
        label,
        invalidates: [[...analysisKey(analysisId)]],
      });
      void outbox.flush();
    },
    [outbox],
  );
}

export function useDeleteNote() {
  const outbox = useOutbox();
  return useCallback(
    async (analysisId: string, noteId: string, label: string) => {
      await outbox.enqueue({
        route: 'deleteNote',
        params: { id: noteId },
        needs: [{ type: 'note', id: noteId }],
        label,
        invalidates: [[...analysisKey(analysisId)]],
      });
      void outbox.flush();
    },
    [outbox],
  );
}
