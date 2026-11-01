import type { Athlete } from '@stride/shared/api/athletes';
import type { Report, ShareCreated } from '@stride/shared/api/reports';
import { formatDisplayDate } from '@stride/shared/dates';
import { LIMITS } from '@stride/shared/limits';
import { shortDisplayName } from '@stride/shared/reportSnapshot';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import form from '../../components/form.module.css';
import ui from '../../components/ui.module.css';
import { useOutboxEntries } from '../../lib/outbox/OutboxProvider';
import { strings } from '../../lib/strings';
import { ShareError, useCreateShare, useRevokeShare, type ShareFailure } from './reportData';
import styles from './reports.module.css';

// The report's share link: made only online and with an active sharing consent, shown once with
// Copy and Send and the reminder that anyone with it can see the report, its expiry, and Revoke.
// The button waits only for a connection: the API decides on the consent (this phone's copy of
// the athlete may be older than a consent recorded elsewhere), and its refusal is shown.

const EXPIRY_CHOICES = [7, LIMITS.shareDefaultDays, 60, LIMITS.shareMaxDays] as const;

const FAILURES: Record<ShareFailure, string> = {
  offline: strings.reports.share.offline,
  not_saved: strings.reports.share.notSaved,
  frames_missing: strings.reports.share.framesMissing,
  consent: strings.reports.share.needsConsent,
  other: strings.reports.share.failed,
};

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

export function ShareSection({
  report,
  athlete,
}: {
  report: Report;
  athlete: Athlete | undefined;
}) {
  const online = useOnline();
  const create = useCreateShare();
  const revoke = useRevokeShare();
  const [days, setDays] = useState<number>(LIMITS.shareDefaultDays);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ShareFailure | null>(null);
  const [link, setLink] = useState<ShareCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const revoking = useOutboxEntries().some(
    (e) => e.route === 'revokeShare' && e.params?.id === report.id,
  );
  const consented = Boolean(athlete?.consents.sharing);
  const name = athlete ? shortDisplayName(athlete.firstName, athlete.lastName) : '';
  const open = revoking ? null : (link ?? report.share);

  const makeLink = async () => {
    setBusy(true);
    setFailure(null);
    setCopied(false);
    try {
      setLink(await create(report.id, report.athleteId, days));
    } catch (error) {
      setFailure(error instanceof ShareError ? error.reason : 'other');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className={styles.section} aria-labelledby="share-heading">
      <h2 id="share-heading">{strings.reports.share.title}</h2>
      <p className={form.hint}>{strings.reports.share.hint}</p>
      <p role="status">
        {revoking
          ? strings.reports.share.revokeQueued
          : open
            ? strings.reports.share.active(formatDisplayDate(open.expiresAt))
            : strings.reports.share.none}
      </p>

      {link && !revoking ? (
        <div className={styles.link}>
          <p className={ui.notice}>{strings.reports.share.created}</p>
          <label className={form.label} htmlFor="share-url">
            {strings.reports.share.linkLabel}
          </label>
          <input
            id="share-url"
            className={form.input}
            readOnly
            value={link.url}
            onFocus={(e) => e.target.select()}
          />
          <p className={form.hint}>{strings.reports.share.reminder}</p>
          <div className={form.actions}>
            <button
              type="button"
              className={`${ui.button} ${ui.secondary}`}
              onClick={() => void copy()}
            >
              {copied ? strings.reports.share.copied : strings.reports.share.copy}
            </button>
            {typeof navigator.share === 'function' ? (
              <button
                type="button"
                className={`${ui.button} ${ui.quiet}`}
                onClick={() =>
                  void navigator
                    .share({ url: link.url, title: strings.reports.share.sendTitle(report.title) })
                    .catch(() => undefined)
                }
              >
                {strings.reports.share.send}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {!consented && athlete ? (
        <p className={ui.notice}>
          {strings.reports.share.needsConsent}{' '}
          <Link to={`/athletes/${athlete.id}/consent`}>{strings.reports.share.recordConsent}</Link>
        </p>
      ) : null}
      {!online ? <p className={ui.notice}>{strings.reports.share.offline}</p> : null}

      <div className={form.field}>
        <label className={form.label} htmlFor="share-days">
          {strings.reports.share.expiryLabel}
        </label>
        <select
          id="share-days"
          className={form.input}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          {EXPIRY_CHOICES.map((d) => (
            <option key={d} value={d}>
              {strings.reports.share.days(d)}
            </option>
          ))}
        </select>
        {open ? <p className={form.hint}>{strings.reports.share.replaceNote}</p> : null}
      </div>
      <div className={form.actions}>
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={!online || busy}
          onClick={() => void makeLink()}
        >
          {busy ? strings.reports.share.creating : strings.reports.share.create}
        </button>
        {open ? (
          <button
            type="button"
            className={`${ui.button} ${ui.quiet}`}
            onClick={() => setConfirming(true)}
          >
            {strings.reports.share.revoke}
          </button>
        ) : null}
      </div>
      {failure ? (
        <p className={form.error} role="alert">
          {FAILURES[failure]}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirming}
        title={strings.reports.share.revokeTitle}
        confirmLabel={strings.reports.share.revoke}
        danger
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          setLink(null);
          void revoke(report.id, report.athleteId, strings.reports.share.outboxRevokeLabel(name));
        }}
      >
        <p>{strings.reports.share.revokeBody}</p>
      </ConfirmDialog>
    </section>
  );
}
