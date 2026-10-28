import type { GateStatus } from '@stride/shared/enums';
import badge from '../../components/badge.module.css';
import { strings } from '../../lib/strings';

/** The quality gate result in words (never colour alone), for lists and the viewer. */
export function GateStatusBadge({ status }: { status: GateStatus }) {
  const tone = status === 'pass' ? badge.ok : status === 'fail' ? badge.missing : badge.neutral;
  return (
    <span className={`${badge.badge} ${tone}`}>
      <span aria-hidden="true">{status === 'pass' ? '✓' : status === 'fail' ? '✕' : '!'}</span>
      {strings.gate.status[status]}
    </span>
  );
}
