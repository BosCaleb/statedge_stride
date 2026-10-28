import type { Athlete, ConsentPut } from '@stride/shared/api/athletes';
import { consentRuleProblem, isMinor } from '@stride/shared/consent';
import {
  CONSENT_PURPOSES,
  type ConsentEvidence,
  type ConsentGiver,
  type ConsentPurpose,
} from '@stride/shared/enums';
import { useId, useState, type FormEvent } from 'react';
import { strings } from '../lib/strings';
import form from './form.module.css';
import ui from './ui.module.css';

/**
 * Records who agreed to what. The rules are the API's: a parent or guardian for a minor, verbal
 * consent for adults only, digital sign-off reserved for later. Purposes already consented to are
 * left out.
 */
export function ConsentForm({
  athlete,
  today,
  onSubmit,
}: {
  athlete: Athlete;
  /** YYYY-MM-DD */
  today: string;
  onSubmit: (consents: ConsentPut[]) => void;
}) {
  const id = useId();
  const year = Number(today.slice(0, 4));
  const minor = isMinor(athlete.birthYear, year);
  const open = CONSENT_PURPOSES.filter((p) => athlete.consents[p] === null);
  const [purposes, setPurposes] = useState<ConsentPurpose[]>(
    open.filter((p) => p !== 'clip_storage'),
  );
  const [givenBy, setGivenBy] = useState<ConsentGiver>(minor ? 'guardian' : 'athlete');
  const [name, setName] = useState(minor ? '' : `${athlete.firstName} ${athlete.lastName}`);
  const [relationship, setRelationship] = useState('');
  const [evidence, setEvidence] = useState<ConsentEvidence>('paper_form');
  const [givenOn, setGivenOn] = useState(today);
  const [errors, setErrors] = useState<string[]>([]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const problems: string[] = [];
    if (purposes.length === 0) problems.push(strings.consent.chooseOne);
    if (!name.trim()) problems.push(strings.consent.nameRequired);
    const rule = consentRuleProblem(athlete.birthYear, year, givenBy, evidence);
    if (rule) problems.push(strings.consent.problems[rule]);
    setErrors(problems);
    if (problems.length > 0) return;
    onSubmit(
      purposes.map((purpose) => ({
        athleteId: athlete.id,
        purpose,
        givenBy,
        givenByName: name.trim(),
        relationship: givenBy === 'guardian' && relationship.trim() ? relationship.trim() : null,
        evidence,
        givenOn,
      })),
    );
  };

  return (
    <form
      className={form.form}
      onSubmit={submit}
      noValidate
      aria-describedby={errors.length ? `${id}-errors` : undefined}
    >
      <fieldset className={form.fieldset}>
        <legend className={form.legend}>{strings.consent.purposesLegend}</legend>
        {open.map((p) => (
          <label key={p} className={form.choice}>
            <input
              type="checkbox"
              checked={purposes.includes(p)}
              onChange={(e) =>
                setPurposes((list) =>
                  e.target.checked ? [...list, p] : list.filter((x) => x !== p),
                )
              }
            />
            {strings.consent.purposes[p]}
          </label>
        ))}
      </fieldset>

      <fieldset className={form.fieldset}>
        <legend className={form.legend}>{strings.consent.givenByLegend}</legend>
        {minor ? <p className={form.hint}>{strings.consent.minorNote}</p> : null}
        {(['athlete', 'guardian'] as const).map((g) => (
          <label key={g} className={form.choice}>
            <input
              type="radio"
              name={`${id}-given-by`}
              checked={givenBy === g}
              disabled={minor && g === 'athlete'}
              onChange={() => {
                setGivenBy(g);
                if (g === 'athlete') setName(`${athlete.firstName} ${athlete.lastName}`);
                else setName('');
              }}
            />
            {strings.consent.givenBy[g]}
          </label>
        ))}
      </fieldset>

      <div className={form.field}>
        <label className={form.label} htmlFor={`${id}-name`}>
          {strings.consent.name}
        </label>
        <input
          id={`${id}-name`}
          className={form.input}
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
        />
      </div>

      {givenBy === 'guardian' ? (
        <div className={form.field}>
          <label className={form.label} htmlFor={`${id}-relationship`}>
            {strings.consent.relationship}
          </label>
          <input
            id={`${id}-relationship`}
            className={form.input}
            value={relationship}
            maxLength={50}
            placeholder={strings.consent.relationshipPlaceholder}
            onChange={(e) => setRelationship(e.target.value)}
            autoComplete="off"
          />
        </div>
      ) : null}

      <fieldset className={form.fieldset}>
        <legend className={form.legend}>{strings.consent.evidenceLegend}</legend>
        {(['paper_form', 'verbal', 'digital'] as const).map((e) => (
          <label key={e} className={form.choice}>
            <input
              type="radio"
              name={`${id}-evidence`}
              checked={evidence === e}
              disabled={e === 'digital' || (minor && e === 'verbal')}
              onChange={() => setEvidence(e)}
            />
            {strings.consent.evidence[e]}
          </label>
        ))}
        <p className={form.hint}>
          <a href="/consent-form.html" target="_blank" rel="noopener">
            {strings.consent.formTemplate}
          </a>
        </p>
      </fieldset>

      <div className={form.field}>
        <label className={form.label} htmlFor={`${id}-date`}>
          {strings.consent.givenOn}
        </label>
        <input
          id={`${id}-date`}
          type="date"
          className={form.input}
          value={givenOn}
          max={today}
          onChange={(e) => setGivenOn(e.target.value || today)}
        />
      </div>

      {errors.length > 0 ? (
        <div id={`${id}-errors`} role="alert">
          {errors.map((e) => (
            <p key={e} className={form.error}>
              {e}
            </p>
          ))}
        </div>
      ) : null}

      <div className={form.actions}>
        <button type="submit" className={`${ui.button} ${ui.primary}`}>
          {strings.consent.save}
        </button>
      </div>
    </form>
  );
}
