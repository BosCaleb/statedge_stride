import type { AuditEntry, Members } from '@stride/shared/api/org';
import { formatDisplayDate } from '@stride/shared/dates';
import type { Role } from '@stride/shared/enums';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import shell from '../../app/shell.module.css';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import form from '../../components/form.module.css';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import ui from '../../components/ui.module.css';
import { ApiProblem } from '../../lib/api';
import { useApi, useMe } from '../../lib/apiContext';
import { strings } from '../../lib/strings';
import styles from './settings.module.css';

// /settings (administrators): organisation, coaches and invites, and the activity log. These
// changes go straight to the API, so they need a connection.

export function SettingsPage() {
  return (
    <div className={shell.page}>
      <h1>{strings.settings.title}</h1>
      <OrganisationSection />
      <MembersSection />
      <AuditSection />
      <p>
        <a href="/privacy.html" target="_blank" rel="noopener">
          {strings.settings.privacy}
        </a>
      </p>
    </div>
  );
}

function OrganisationSection() {
  const me = useMe();
  const call = useApi();
  const queryClient = useQueryClient();
  const org = me.data?.organisation;
  const [days, setDays] = useState(String(org?.clipRetentionDays ?? 90));
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  if (!org) return null;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setStatus('saving');
    try {
      await call('patchOrg', { body: { clipRetentionDays: Number(days) } });
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      setStatus('saved');
    } catch {
      setStatus('failed');
    }
  };
  const valid = Number.isInteger(Number(days)) && Number(days) >= 1 && Number(days) <= 365;

  return (
    <section className={`${ui.card} ${styles.section}`} aria-labelledby="org-heading">
      <h2 id="org-heading">{strings.settings.organisation}</h2>
      <p>
        {org.name} · {strings.settings.type[org.type]}
      </p>
      <form className={form.form} onSubmit={(e) => void save(e)}>
        <div className={form.field}>
          <label className={form.label} htmlFor="retention">
            {strings.settings.retention}
          </label>
          <input
            id="retention"
            className={form.input}
            inputMode="numeric"
            value={days}
            aria-invalid={valid ? undefined : true}
            onChange={(e) => {
              setDays(e.target.value);
              setStatus('idle');
            }}
          />
          <p className={form.hint}>{strings.settings.retentionHint}</p>
        </div>
        <div className={form.actions}>
          <button
            type="submit"
            className={`${ui.button} ${ui.primary}`}
            disabled={!valid || status === 'saving'}
          >
            {strings.settings.save}
          </button>
          {status === 'saved' ? <span role="status">{strings.settings.saved}</span> : null}
          {status === 'failed' ? (
            <span role="alert" className={form.error}>
              {strings.settings.saveFailed}
            </span>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function MembersSection() {
  const call = useApi();
  const me = useMe();
  const members = useQuery({
    queryKey: ['members'],
    queryFn: async ({ signal }) => (await call('listMembers', { signal })).data,
  });
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<Members['items'][number] | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['members'] });

  if (members.isPending) return <LoadingState />;
  if (!members.data)
    return <ErrorState title={strings.errors.title} onRetry={() => void members.refetch()} />;
  const m = members.data;

  return (
    <section className={`${ui.card} ${styles.section}`} aria-labelledby="members-heading">
      <h2 id="members-heading">{strings.settings.members}</h2>
      <p>{strings.settings.seats(m.seatsUsed, m.maxCoaches)}</p>
      <ul className={styles.list}>
        {m.items.map((coach) => (
          <li key={coach.id} className={styles.item}>
            <div>
              <p className={styles.primary}>
                {coach.displayName ?? coach.email}
                {coach.id === me.data?.coach.id ? ` (${strings.settings.you})` : ''}
              </p>
              <p className={form.hint}>
                {coach.email} · {strings.settings.roles[coach.role]}
                {coach.status === 'removed' ? ` · ${strings.settings.removed}` : ''} ·{' '}
                {coach.lastSeenAt
                  ? strings.settings.lastSeen(formatDisplayDate(coach.lastSeenAt))
                  : strings.settings.neverSeen}
              </p>
            </div>
            {coach.status === 'active' && coach.id !== me.data?.coach.id ? (
              <button
                type="button"
                className={`${ui.button} ${ui.quiet}`}
                onClick={() => setRemoving(coach)}
              >
                {strings.settings.remove}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {m.pendingInvites.length > 0 ? (
        <>
          <h3>{strings.settings.pending}</h3>
          <ul className={styles.list}>
            {m.pendingInvites.map((invite) => (
              <li key={invite.id} className={styles.item}>
                <div>
                  <p className={styles.primary}>{invite.email}</p>
                  <p className={form.hint}>
                    {strings.settings.roles[invite.role]} ·{' '}
                    {strings.settings.expires(formatDisplayDate(invite.expiresAt))}
                  </p>
                </div>
                <button
                  type="button"
                  className={`${ui.button} ${ui.quiet}`}
                  onClick={() =>
                    void call('revokeInvite', { params: { id: invite.id } }).then(refresh)
                  }
                >
                  {strings.settings.withdrawInvite}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <InviteForm onCreated={() => void refresh()} />
      <ConfirmDialog
        open={removing !== null}
        title={strings.settings.removeTitle}
        confirmLabel={strings.settings.remove}
        danger
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing)
            void call('removeMember', { params: { coachId: removing.id } }).then(refresh);
          setRemoving(null);
        }}
      >
        <p>{strings.settings.removeBody}</p>
      </ConfirmDialog>
    </section>
  );
}

function InviteForm({ onCreated }: { onCreated: () => void }) {
  const call = useApi();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('coach');
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const created = (await call('createInvite', { body: { email: email.trim(), role } })).data;
      setLink({ url: created.url, expiresAt: created.expiresAt });
      setEmail('');
      onCreated();
    } catch (e) {
      const code = e instanceof ApiProblem ? e.code : null;
      setError(
        code === 'seat_limit' || code === 'conflict'
          ? strings.settings.inviteFailed[code]
          : strings.settings.inviteFailed.other,
      );
    }
  };

  if (link) {
    return (
      <div className={styles.inviteLink} role="status">
        <h3>{strings.settings.inviteReady}</h3>
        <p className={styles.url}>{link.url}</p>
        <p className={form.hint}>
          {strings.settings.inviteNote(formatDisplayDate(link.expiresAt))}
        </p>
        <div className={form.actions}>
          <button
            type="button"
            className={`${ui.button} ${ui.primary}`}
            onClick={() =>
              void navigator.clipboard?.writeText(link.url).then(() => setCopied(true))
            }
          >
            {copied ? strings.settings.copied : strings.settings.copy}
          </button>
          {typeof navigator.share === 'function' ? (
            <button
              type="button"
              className={`${ui.button} ${ui.secondary}`}
              onClick={() => void navigator.share({ url: link.url }).catch(() => undefined)}
            >
              {strings.settings.share}
            </button>
          ) : null}
          <button
            type="button"
            className={`${ui.button} ${ui.quiet}`}
            onClick={() => {
              setLink(null);
              setCopied(false);
            }}
          >
            {strings.settings.done}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className={form.form} onSubmit={(e) => void submit(e)}>
      <h3>{strings.settings.invite}</h3>
      <div className={form.field}>
        <label className={form.label} htmlFor="invite-email">
          {strings.settings.email}
        </label>
        <input
          id="invite-email"
          type="email"
          className={form.input}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="off"
        />
      </div>
      <div className={form.field}>
        <label className={form.label} htmlFor="invite-role">
          {strings.settings.role}
        </label>
        <select
          id="invite-role"
          className={form.input}
          value={role}
          onChange={(e) => setRole(e.target.value === 'admin' ? 'admin' : 'coach')}
        >
          <option value="coach">{strings.settings.roles.coach}</option>
          <option value="admin">{strings.settings.roles.admin}</option>
        </select>
      </div>
      {error ? (
        <p className={form.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={form.actions}>
        <button
          type="submit"
          className={`${ui.button} ${ui.primary}`}
          disabled={!email.includes('@')}
        >
          {strings.settings.sendInvite}
        </button>
      </div>
    </form>
  );
}

function AuditSection() {
  const call = useApi();
  const members = useQuery({
    queryKey: ['members'],
    queryFn: async ({ signal }) => (await call('listMembers', { signal })).data,
  });
  const audit = useInfiniteQuery({
    queryKey: ['audit'],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      (
        await call('listAudit', {
          query: { limit: 25, ...(pageParam ? { cursor: pageParam } : {}) },
          signal,
        })
      ).data,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const who = (entry: AuditEntry) => {
    if (!entry.coachId) return strings.settings.byStatEdge;
    const coach = members.data?.items.find((c) => c.id === entry.coachId);
    return coach?.displayName ?? coach?.email ?? '';
  };
  const entries = audit.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section className={`${ui.card} ${styles.section}`} aria-labelledby="audit-heading">
      <h2 id="audit-heading">{strings.settings.audit}</h2>
      {audit.isPending ? (
        <LoadingState />
      ) : entries.length === 0 ? (
        <EmptyState title={strings.settings.auditEmpty} />
      ) : (
        <ul className={styles.list}>
          {entries.map((entry) => (
            <li key={entry.id} className={styles.item}>
              <div>
                <p className={styles.primary}>{strings.settings.auditActions[entry.action]}</p>
                <p className={form.hint}>
                  {formatDisplayDate(entry.at)} · {who(entry)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {audit.hasNextPage ? (
        <button
          type="button"
          className={`${ui.button} ${ui.quiet}`}
          onClick={() => void audit.fetchNextPage()}
        >
          {strings.settings.loadMore}
        </button>
      ) : null}
    </section>
  );
}
