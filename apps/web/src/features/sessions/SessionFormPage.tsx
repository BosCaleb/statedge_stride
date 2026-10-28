import type { SessionDetail } from '@stride/shared/api/sessions';
import { SURFACES, type Mode, type Surface } from '@stride/shared/enums';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import shell from '../../app/shell.module.css';
import { ConsentBadge } from '../../components/ConsentBadge';
import form from '../../components/form.module.css';
import { ErrorState, LoadingState } from '../../components/States';
import ui from '../../components/ui.module.css';
import { localDateIso } from '../../lib/localDate';
import { strings } from '../../lib/strings';
import { useUiStore } from '../../stores/uiStore';
import { useAthletes } from '../athletes/athleteData';
import { useSaveSession, useSession } from './sessionData';
import styles from './sessions.module.css';

/** /sessions/new and /sessions/:id/edit: date, mode, place, surface, footwear and athletes. */
export function SessionFormPage() {
  const { id } = useParams();
  const existing = useSession(id ?? '');
  if (id && existing.isPending) return <LoadingState />;
  if (id && !existing.data) return <ErrorState title={strings.sessions.notFound} />;
  return <SessionForm detail={id ? existing.data : undefined} />;
}

function SessionForm({ detail }: { detail: SessionDetail | undefined }) {
  const session = detail?.session;
  const save = useSaveSession();
  const navigate = useNavigate();
  const athletes = useAthletes();
  const setSessionAthletes = useUiStore((s) => s.setSessionAthletes);
  const setActiveSession = useUiStore((s) => s.setActiveSession);
  const today = localDateIso();
  const [date, setDate] = useState(session?.sessionDate ?? today);
  const [mode, setMode] = useState<Mode>(session?.mode ?? 'sprint');
  const [place, setPlace] = useState(session?.place ?? '');
  const [surface, setSurface] = useState<Surface | ''>(session?.surface ?? '');
  const [footwear, setFootwear] = useState(session?.footwear ?? '');
  const [notes, setNotes] = useState(session?.notes ?? '');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const id = session?.id ?? crypto.randomUUID();
    await save(id, {
      sessionDate: date,
      place: place.trim() || null,
      surface: surface || null,
      footwear: footwear.trim() || null,
      mode,
      notes: notes.trim() || null,
    });
    setActiveSession(id);
    if (!session) {
      setSessionAthletes(id, picked);
      void navigate(`/import?session=${id}`, { replace: true });
    } else {
      void navigate(`/sessions/${id}`, { replace: true });
    }
  };

  return (
    <div className={shell.page}>
      <h1>{session ? strings.sessions.editTitle : strings.sessions.newTitle}</h1>
      <form className={form.form} onSubmit={(e) => void submit(e)}>
        <div className={form.field}>
          <label className={form.label} htmlFor="session-date">
            {strings.sessions.date}
          </label>
          <input
            id="session-date"
            type="date"
            className={form.input}
            value={date}
            max={today}
            required
            onChange={(e) => setDate(e.target.value || today)}
          />
        </div>

        <fieldset className={form.fieldset}>
          <legend className={form.legend}>{strings.sessions.mode}</legend>
          {(['sprint', 'distance'] as const).map((m) => (
            <label key={m} className={form.choice}>
              <input
                type="radio"
                name="session-mode"
                checked={mode === m}
                onChange={() => setMode(m)}
              />
              <span>
                {strings.sessions.modes[m]}
                <span className={form.hint}> · {strings.sessions.modeHints[m]}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className={form.field}>
          <label className={form.label} htmlFor="session-place">
            {strings.sessions.place}
          </label>
          <input
            id="session-place"
            className={form.input}
            value={place}
            maxLength={200}
            placeholder={strings.sessions.placePlaceholder}
            onChange={(e) => setPlace(e.target.value)}
          />
        </div>

        <div className={form.field}>
          <label className={form.label} htmlFor="session-surface">
            {strings.sessions.surface}
          </label>
          <select
            id="session-surface"
            className={form.input}
            value={surface}
            onChange={(e) => {
              const value = SURFACES.find((s) => s === e.target.value);
              setSurface(value ?? '');
            }}
          >
            <option value="">{strings.sessions.surfaceNotSet}</option>
            {SURFACES.map((s) => (
              <option key={s} value={s}>
                {strings.sessions.surfaces[s]}
              </option>
            ))}
          </select>
        </div>

        <div className={form.field}>
          <label className={form.label} htmlFor="session-footwear">
            {strings.sessions.footwear}
          </label>
          <input
            id="session-footwear"
            className={form.input}
            value={footwear}
            maxLength={100}
            placeholder={strings.sessions.footwearPlaceholder}
            onChange={(e) => setFootwear(e.target.value)}
          />
        </div>

        <div className={form.field}>
          <label className={form.label} htmlFor="session-notes">
            {strings.sessions.notes}
          </label>
          <textarea
            id="session-notes"
            className={form.input}
            rows={3}
            value={notes}
            maxLength={1000}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {!session ? (
          <fieldset className={form.fieldset}>
            <legend className={form.legend}>{strings.sessions.athletesLegend}</legend>
            <p className={form.hint}>{strings.sessions.athletesHint}</p>
            {(athletes.data ?? []).length === 0 ? (
              <p className={form.hint}>{strings.sessions.noAthletes}</p>
            ) : (
              <ul className={styles.pickList}>
                {(athletes.data ?? []).map((a) => (
                  <li key={a.id}>
                    <label className={form.choice}>
                      <input
                        type="checkbox"
                        checked={picked.includes(a.id)}
                        onChange={(e) =>
                          setPicked((list) =>
                            e.target.checked ? [...list, a.id] : list.filter((x) => x !== a.id),
                          )
                        }
                      />
                      <span>
                        {a.firstName} {a.lastName}{' '}
                        <ConsentBadge consents={a.consents} purpose="analysis" />
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        ) : null}

        <div className={form.actions}>
          <button type="submit" className={`${ui.button} ${ui.primary}`} disabled={busy}>
            {session ? strings.sessions.save : strings.sessions.create}
          </button>
        </div>
      </form>
    </div>
  );
}
