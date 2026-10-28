import type { Athlete } from '@stride/shared/api/athletes';
import { formatDisplayDate } from '@stride/shared/dates';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import shell from '../../app/shell.module.css';
import { ClipInfoCard } from '../../components/ClipInfoCard';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import ui from '../../components/ui.module.css';
import { deleteCopy } from '../../lib/local/clipLibrary';
import {
  storeLocalClips,
  useLocalCalibrations,
  useLocalClips,
  useLocalResults,
} from '../../lib/local/localQueries';
import type { LocalClip } from '../../lib/local/records';
import { useObjectUrl } from '../../lib/useObjectUrl';
import { strings } from '../../lib/strings';
import { useAthletes } from '../athletes/athleteData';
import { GateStatusBadge } from '../results/GateStatusBadge';
import { useSession } from './sessionData';
import styles from './sessions.module.css';

/** /sessions/:id: the session's calibrations, the clips on this phone and the analyses. */
export function SessionPage() {
  const { id = '' } = useParams();
  const detail = useSession(id);
  const clips = useLocalClips();
  const calibrations = useLocalCalibrations();
  const results = useLocalResults();
  const athletes = useAthletes();
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<LocalClip | null>(null);

  const athleteById = useMemo(
    () => new Map((athletes.data ?? []).map((a) => [a.id, a])),
    [athletes.data],
  );
  const name = (athleteId: string | null) => {
    const a: Athlete | undefined = athleteId ? athleteById.get(athleteId) : undefined;
    return a ? `${a.firstName} ${a.lastName}` : strings.sessions.unknownAthlete;
  };

  if (detail.isPending) return <LoadingState />;
  if (!detail.data)
    return <ErrorState title={strings.sessions.notFound} onRetry={() => void detail.refetch()} />;
  const { session } = detail.data;
  const sessionClips = (clips.data ?? []).filter((c) => c.sessionId === id);
  const runs = sessionClips.filter((c) => c.role === 'run');
  const localCals = (calibrations.data ?? []).filter((c) => c.sessionId === id);
  const serverCals = detail.data.calibrations.filter((c) => !localCals.some((l) => l.id === c.id));
  const localResults = (results.data ?? []).filter((r) => r.sessionId === id);
  const serverAnalyses = detail.data.analyses.filter(
    (a) => !localResults.some((r) => r.id === a.id),
  );

  return (
    <div className={shell.page}>
      <div className={styles.toolbar}>
        <h1>{strings.sessions.title(formatDisplayDate(session.sessionDate))}</h1>
        <Link to={`/sessions/${id}/edit`} className={`${ui.button} ${ui.quiet}`}>
          {strings.sessions.edit}
        </Link>
      </div>
      <p className={styles.summary}>
        {[
          strings.sessions.modes[session.mode],
          session.place,
          session.surface ? strings.sessions.surfaces[session.surface] : null,
          session.footwear,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {session.notes ? <p className={styles.notes}>{session.notes}</p> : null}
      <Link to={`/import?session=${id}`} className={`${ui.button} ${ui.primary}`}>
        {strings.sessions.importClips}
      </Link>

      <section className={styles.section} aria-labelledby="calibrations-heading">
        <h2 id="calibrations-heading">{strings.sessions.calibrations}</h2>
        {localCals.length + serverCals.length === 0 ? (
          <p className={styles.muted}>{strings.sessions.noCalibrations}</p>
        ) : (
          <ul className={styles.list}>
            {localCals.map((c) => (
              <li key={c.id} className={styles.calibration}>
                <CalibrationFrame frame={c.frame} />
                <span>
                  {strings.sessions.calibrationLine(c.distanceM.toFixed(2), c.pxPerM.toFixed(0))}
                </span>
              </li>
            ))}
            {serverCals.map((c) => (
              <li key={c.id} className={styles.calibration}>
                <span>
                  {strings.sessions.calibrationLine(c.distanceM.toFixed(2), c.pxPerM.toFixed(0))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-labelledby="clips-heading">
        <h2 id="clips-heading">{strings.sessions.clips}</h2>
        {sessionClips.length === 0 ? (
          <p className={styles.muted}>{strings.sessions.noClips}</p>
        ) : (
          <ul className={styles.list}>
            {[...runs, ...sessionClips.filter((c) => c.role === 'calibration')].map((clip) => (
              <li key={clip.id}>
                <ClipInfoCard
                  facts={{ ...clip, fileFps: clip.detectedFps }}
                  label={
                    clip.role === 'run'
                      ? `${strings.clips.runClip} · ${name(clip.athleteId)}`
                      : strings.clips.calibrationClip
                  }
                >
                  <p className={styles.muted}>
                    {clip.copy === 'none' ? strings.clips.copyNotKept : strings.clips.copyKept}
                  </p>
                  <div className={styles.actions}>
                    {clip.role === 'run' ? (
                      <Link to={`/analyse/${clip.id}`} className={`${ui.button} ${ui.primary}`}>
                        {strings.clips.analyse}
                      </Link>
                    ) : null}
                    {clip.copy !== 'none' ? (
                      <button
                        type="button"
                        className={`${ui.button} ${ui.quiet}`}
                        onClick={() => setRemoving(clip)}
                      >
                        {strings.clips.removeCopy}
                      </button>
                    ) : null}
                  </div>
                </ClipInfoCard>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-labelledby="analyses-heading">
        <h2 id="analyses-heading">{strings.sessions.analyses}</h2>
        {localResults.length + serverAnalyses.length === 0 ? (
          <EmptyState title={strings.sessions.noAnalyses} />
        ) : (
          <ul className={styles.list}>
            {localResults.map((r) => (
              <li key={r.id}>
                <Link to={`/analyses/${r.id}`} className={styles.row}>
                  <span className={styles.name}>{name(r.athleteId)}</span>
                  <span className={styles.meta}>
                    <GateStatusBadge status={r.result.gate.status} />
                    {r.savedAt ? null : <span>{strings.sessions.notSaved}</span>}
                  </span>
                </Link>
              </li>
            ))}
            {serverAnalyses.map((a) => (
              <li key={a.id}>
                <Link to={`/analyses/${a.id}`} className={styles.row}>
                  <span className={styles.name}>{name(a.athleteId)}</span>
                  <span className={styles.meta}>
                    <GateStatusBadge status={a.gateStatus} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={removing !== null}
        title={strings.clips.removeCopyTitle}
        confirmLabel={strings.clips.removeCopy}
        danger
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const clip = removing;
          setRemoving(null);
          if (!clip) return;
          void deleteCopy(clip.id).then(() =>
            storeLocalClips(queryClient, [{ ...clip, copy: 'none' }]),
          );
        }}
      >
        <p>{strings.clips.removeCopyBody}</p>
      </ConfirmDialog>
    </div>
  );
}

function CalibrationFrame({ frame }: { frame: Blob }) {
  const url = useObjectUrl(frame);
  return url ? (
    <img className={styles.frame} src={url} alt={strings.sessions.calibrationFrame} />
  ) : null;
}
