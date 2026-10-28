import { defaultConfig } from '@stride/analysis/config';
import type { DeviceCheckPost } from '@stride/shared/api/devices';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { readClipFacts, type ClipFacts } from '../../analysis-runtime/clipFacts';
import { webCodecsSupported } from '../../analysis-runtime/decoder';
import { FrameGrabber } from '../../analysis-runtime/frameGrab';
import type { ProbeError } from '../../analysis-runtime/probe';
import shell from '../../app/shell.module.css';
import badge from '../../components/badge.module.css';
import { ClipInfoCard } from '../../components/ClipInfoCard';
import { ClipPicker } from '../../components/ClipPicker';
import form from '../../components/form.module.css';
import { LoadingState } from '../../components/States';
import ui from '../../components/ui.module.css';
import { useApi } from '../../lib/apiContext';
import { useOutbox } from '../../lib/outbox/OutboxProvider';
import { strings } from '../../lib/strings';
import { GateChecksList } from '../analyse/GateChecksList';
import { FPS_CHOICES } from '../import/importLogic';
import {
  describePhone,
  evaluateDeviceClip,
  reportedModel,
  type DeviceOutcome,
} from './deviceCheck';
import styles from './device.module.css';

// /device-check: verify a phone and its slow-motion mode with a short test clip. Shows the
// frame rate, resolution, codec, frame timing and length, a pass, conditional or fail result
// with the reasons, and records it (through the outbox) with the phone model.

type Checked =
  | { kind: 'reading'; name: string }
  | { kind: 'unreadable'; name: string; reason: ProbeError }
  | { kind: 'done'; file: File; facts: ClipFacts; decodable: boolean };

async function canDecode(file: File, facts: ClipFacts): Promise<boolean> {
  if (await webCodecsSupported(facts.probe)) return true;
  // The video-element decoder takes over where WebCodecs cannot.
  const grabber = new FrameGrabber(file);
  try {
    (await grabber.grab(0)).close();
    return true;
  } catch {
    return false;
  } finally {
    grabber.dispose();
  }
}

export function DeviceCheckPage() {
  const call = useApi();
  const outbox = useOutbox();
  const phone = describePhone(navigator.userAgent);
  const [model, setModel] = useState(phone.model ?? '');
  const [declaredFps, setDeclaredFps] = useState<number>(240);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [recorded, setRecorded] = useState(false);
  const profiles = useQuery({
    queryKey: ['deviceProfiles'],
    queryFn: async ({ signal }) => (await call('deviceProfiles', { signal })).data.items,
    staleTime: 60 * 60_000,
  });

  useEffect(() => {
    void reportedModel().then((m) => {
      if (m) setModel((current) => current || m);
    });
  }, []);

  const pick = async (file: File) => {
    setRecorded(false);
    setChecked({ kind: 'reading', name: file.name });
    const facts = await readClipFacts(file, defaultConfig);
    if (!facts.ok) {
      setChecked({ kind: 'unreadable', name: file.name, reason: facts.reason });
      return;
    }
    setChecked({
      kind: 'done',
      file,
      facts: facts.value,
      decodable: await canDecode(file, facts.value),
    });
  };

  const outcome: DeviceOutcome | null =
    checked?.kind === 'done'
      ? evaluateDeviceClip(
          {
            containerTimesSec: checked.facts.probe.containerTimesSec,
            widthPx: checked.facts.probe.widthPx,
            heightPx: checked.facts.probe.heightPx,
            durationSec: checked.facts.probe.durationSec,
            decodable: checked.decodable,
            declaredFps,
          },
          defaultConfig,
        )
      : null;

  const record = async () => {
    if (checked?.kind !== 'done' || !outcome) return;
    const probe = checked.facts.probe;
    const body: DeviceCheckPost = {
      id: crypto.randomUUID(),
      deviceModel: model.trim().slice(0, 100) || null,
      os: phone.os,
      browser: phone.browser,
      declaredFps,
      detectedFps: outcome.fileFps,
      widthPx: probe.widthPx,
      heightPx: probe.heightPx,
      codec: probe.codec.slice(0, 30),
      timingJitter: outcome.timingJitter,
      result: outcome.result,
      reason: outcome.reasons.join(',').slice(0, 400) || null,
    };
    await outbox.enqueue({
      route: 'postDeviceCheck',
      body,
      resource: { type: 'device-check', id: body.id },
      label: strings.device.outboxLabel(body.deviceModel ?? strings.device.thisPhone),
    });
    void outbox.flush();
    setRecorded(true);
  };

  return (
    <div className={shell.page}>
      <h1>{strings.device.title}</h1>
      <p>{strings.device.intro}</p>

      <div className={form.field}>
        <label className={form.label} htmlFor="device-model">
          {strings.device.model}
        </label>
        <input
          id="device-model"
          className={form.input}
          value={model}
          maxLength={100}
          placeholder={strings.device.modelPlaceholder}
          onChange={(e) => setModel(e.target.value)}
          autoComplete="off"
        />
        <p className={form.hint}>
          {[phone.os, phone.browser].filter(Boolean).join(' · ') || strings.device.unknownPhone}
        </p>
      </div>
      <div className={form.field}>
        <label className={form.label} htmlFor="device-fps">
          {strings.importClips.recordedAt}
        </label>
        <select
          id="device-fps"
          className={form.input}
          value={declaredFps}
          onChange={(e) => setDeclaredFps(Number(e.target.value))}
        >
          {FPS_CHOICES.map((f) => (
            <option key={f} value={f}>
              {strings.importClips.fpsOption(f)}
            </option>
          ))}
        </select>
      </div>

      <ClipPicker
        label={strings.device.pick}
        hint={strings.device.pickHint}
        multiple={false}
        onPick={(files) => {
          const [f] = files;
          if (f) void pick(f);
        }}
      />

      {checked?.kind === 'reading' ? <LoadingState label={strings.importClips.reading} /> : null}
      {checked?.kind === 'unreadable' ? (
        <p className={form.error} role="alert">
          {strings.importClips.unreadable[checked.reason]}
        </p>
      ) : null}
      {checked?.kind === 'done' && outcome ? (
        <section className={styles.result} aria-labelledby="device-result">
          <h2 id="device-result" className={styles.resultTitle}>
            <span
              className={`${badge.badge} ${outcome.result === 'pass' ? badge.ok : outcome.result === 'fail' ? badge.missing : badge.neutral}`}
            >
              {strings.device.results[outcome.result]}
            </span>
          </h2>
          <p>{strings.device.resultBody[outcome.result]}</p>
          <ClipInfoCard
            facts={{
              fileName: checked.file.name,
              widthPx: checked.facts.probe.widthPx,
              heightPx: checked.facts.probe.heightPx,
              durationSec: checked.facts.probe.durationSec,
              codec: checked.facts.probe.codec,
              fileFps: outcome.fileFps,
              irregularShare: outcome.irregularShare,
            }}
          >
            <p className={form.hint}>
              {outcome.timingJitter === null
                ? null
                : strings.device.jitter((outcome.timingJitter * 100).toFixed(1))}
            </p>
          </ClipInfoCard>
          {outcome.retimed ? (
            <p className={ui.notice}>{strings.device.retimed(declaredFps)}</p>
          ) : null}
          <GateChecksList checks={outcome.checks.filter((c) => c.level !== 'pass')} />
          <div className={form.actions}>
            <button
              type="button"
              className={`${ui.button} ${ui.primary}`}
              disabled={recorded}
              onClick={() => void record()}
            >
              {strings.device.record}
            </button>
            {recorded ? <span role="status">{strings.device.recorded}</span> : null}
          </div>
        </section>
      ) : null}

      <section className={styles.profiles} aria-labelledby="profiles-heading">
        <h2 id="profiles-heading">{strings.device.testedPhones}</h2>
        {profiles.isPending ? (
          <LoadingState />
        ) : (profiles.data ?? []).length === 0 ? (
          <p className={form.hint}>{strings.device.noProfiles}</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{strings.device.phone}</th>
                <th scope="col">{strings.device.tier}</th>
                <th scope="col">{strings.device.slowMotion}</th>
              </tr>
            </thead>
            <tbody>
              {(profiles.data ?? []).map((p) => (
                <tr key={p.model}>
                  <th scope="row">
                    {p.model}
                    {p.notes ? <span className={styles.note}>{p.notes}</span> : null}
                  </th>
                  <td>{strings.device.tiers[p.tier]}</td>
                  <td>{p.maxSlowmo ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
