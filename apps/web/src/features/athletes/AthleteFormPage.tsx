import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import shell from '../../app/shell.module.css';
import form from '../../components/form.module.css';
import { ErrorState, LoadingState } from '../../components/States';
import ui from '../../components/ui.module.css';
import { strings } from '../../lib/strings';
import type { Athlete } from '@stride/shared/api/athletes';
import { useAthlete, useSaveAthlete } from './athleteData';

const MIN_YEAR = 1940;

/** /athletes/new and /athletes/:id/edit: name, birth year and an optional number. */
export function AthleteFormPage() {
  const { id: existingId } = useParams();
  const existing = useAthlete(existingId ?? '');
  if (existingId && existing.isPending) return <LoadingState />;
  if (existingId && !existing.data) return <ErrorState title={strings.athlete.notFound} />;
  return <AthleteForm athlete={existing.data} />;
}

function AthleteForm({ athlete }: { athlete: Athlete | undefined }) {
  const existingId = athlete?.id;
  const save = useSaveAthlete();
  const navigate = useNavigate();
  const thisYear = new Date().getUTCFullYear();
  const [firstName, setFirstName] = useState(athlete?.firstName ?? '');
  const [lastName, setLastName] = useState(athlete?.lastName ?? '');
  const [birthYear, setBirthYear] = useState(athlete ? String(athlete.birthYear) : '');
  const [externalRef, setExternalRef] = useState(athlete?.externalRef ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const year = Number(birthYear);
    const next: Record<string, string> = {};
    if (!firstName.trim()) next.firstName = strings.athlete.invalid.firstName;
    if (!lastName.trim()) next.lastName = strings.athlete.invalid.lastName;
    if (!Number.isInteger(year) || year < MIN_YEAR || year > thisYear)
      next.birthYear = strings.athlete.invalid.birthYear(MIN_YEAR, thisYear);
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const id = existingId ?? crypto.randomUUID();
    await save(id, {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      birthYear: year,
      externalRef: externalRef.trim() || null,
    });
    void navigate(existingId ? `/athletes/${id}` : `/athletes/${id}/consent`, { replace: true });
  };

  const field = (
    key: string,
    label: string,
    value: string,
    set: (v: string) => void,
    extra: Record<string, unknown> = {},
  ) => (
    <div className={form.field}>
      <label className={form.label} htmlFor={`athlete-${key}`}>
        {label}
      </label>
      <input
        id={`athlete-${key}`}
        className={form.input}
        value={value}
        onChange={(e) => set(e.target.value)}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={errors[key] ? `athlete-${key}-error` : undefined}
        autoComplete="off"
        {...extra}
      />
      {errors[key] ? (
        <p id={`athlete-${key}-error`} className={form.error}>
          {errors[key]}
        </p>
      ) : null}
    </div>
  );

  return (
    <div className={shell.page}>
      <h1>{existingId ? strings.athlete.editTitle : strings.athlete.newTitle}</h1>
      <form className={form.form} onSubmit={(e) => void submit(e)} noValidate>
        {field('firstName', strings.athlete.firstName, firstName, setFirstName, { maxLength: 100 })}
        {field('lastName', strings.athlete.lastName, lastName, setLastName, { maxLength: 100 })}
        {field('birthYear', strings.athlete.birthYear, birthYear, setBirthYear, {
          inputMode: 'numeric',
          pattern: '[0-9]*',
          maxLength: 4,
        })}
        <p className={form.hint}>{strings.athlete.birthYearHint}</p>
        {field('externalRef', strings.athlete.externalRef, externalRef, setExternalRef, {
          maxLength: 50,
        })}
        <div className={form.actions}>
          <button type="submit" className={`${ui.button} ${ui.primary}`}>
            {existingId ? strings.athlete.save : strings.athlete.saveAndConsent}
          </button>
        </div>
      </form>
    </div>
  );
}
