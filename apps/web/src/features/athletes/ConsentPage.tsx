import { useNavigate, useParams } from 'react-router';
import shell from '../../app/shell.module.css';
import { ConsentForm } from '../../components/ConsentForm';
import { ErrorState, LoadingState } from '../../components/States';
import { localDateIso } from '../../lib/localDate';
import { strings } from '../../lib/strings';
import { useAthlete, useRecordConsents } from './athleteData';

/** /athletes/:id/consent: record consent for analysis, sharing and clip storage. */
export function ConsentPage() {
  const { id = '' } = useParams();
  const athlete = useAthlete(id);
  const record = useRecordConsents();
  const navigate = useNavigate();
  if (athlete.isPending) return <LoadingState />;
  if (!athlete.data) return <ErrorState title={strings.athlete.notFound} />;
  const a = athlete.data;
  return (
    <div className={shell.page}>
      <h1>{strings.consent.title}</h1>
      <p>
        {a.firstName} {a.lastName}
      </p>
      <ConsentForm
        athlete={a}
        today={localDateIso()}
        onSubmit={(puts) => {
          void record(
            a,
            puts.map((put) => ({ id: crypto.randomUUID(), put })),
          ).then(() => navigate(`/athletes/${a.id}`, { replace: true }));
        }}
      />
    </div>
  );
}
