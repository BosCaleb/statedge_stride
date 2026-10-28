import { useState } from 'react';
import { detectCapabilities, missingCapabilities, type Capability } from '../lib/capabilities';
import { readPreference, writePreference } from '../lib/storage';
import { strings } from '../lib/strings';
import { ConfirmDialog } from '../components/ConfirmDialog';

const KEY = 'stride.capabilitiesChecked';

const LABELS: Record<Capability, string> = {
  workers: strings.capabilities.workers,
  webCodecs: strings.capabilities.webCodecs,
  gpu: strings.capabilities.gpu,
  opfs: strings.capabilities.opfs,
  compression: strings.capabilities.compression,
  wakeLock: strings.capabilities.wakeLock,
};

/** On first launch, lists any missing browser feature that the analysis loop needs. */
export function CapabilityNotice() {
  const [missing] = useState(() => {
    if (readPreference(KEY) !== null) return [];
    const { blocking, degraded } = missingCapabilities(detectCapabilities());
    writePreference(KEY, new Date().toISOString());
    return [...blocking, ...degraded];
  });
  const [open, setOpen] = useState(missing.length > 0);
  return (
    <ConfirmDialog
      open={open}
      title={strings.capabilities.title}
      confirmLabel={strings.capabilities.dismiss}
      hideCancel
      onConfirm={() => setOpen(false)}
      onCancel={() => setOpen(false)}
    >
      <p>{strings.capabilities.intro}</p>
      <ul>
        {missing.map((c) => (
          <li key={c}>{LABELS[c]}</li>
        ))}
      </ul>
      <p>{strings.capabilities.unsupported}</p>
    </ConfirmDialog>
  );
}
