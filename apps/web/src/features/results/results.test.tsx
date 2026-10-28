import { runSynthetic } from '@stride/analysis/testing/runSynthetic';
import { generateGait } from '@stride/analysis/testing/syntheticGait';
import { LM, LANDMARK_COUNT, type Landmark } from '@stride/analysis/types';
import type { MetricResult } from '@stride/shared/analysisResult';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ConfidenceBadge } from '../../components/ConfidenceBadge';
import { GateBanner } from '../../components/GateBanner';
import { MetricCard } from '../../components/MetricCard';
import { frameAngles } from './frameAngles';
import { formatValue, groupMetrics, warningEffects } from './metricFormat';

const uncalibrated = runSynthetic(generateGait({ noisePx: 1 }), {
  mode: 'distance',
  calibration: null,
}).result;
const calibrated = runSynthetic(generateGait({ noisePx: 1 }), { mode: 'distance' }).result;

describe('metric display', () => {
  it('rounds as the spec says, and never shows minus zero', () => {
    expect(formatValue(176.4, 'spm')).toBe('176');
    expect(formatValue(212.6, 'ms')).toBe('213');
    expect(formatValue(6.04, 'deg')).toBe('6.0');
    expect(formatValue(1.234, 'm')).toBe('1.23');
    expect(formatValue(19.26, '%L')).toBe('19.3');
    expect(formatValue(-0.04, 'deg')).toBe('0.0');
    expect(formatValue(null, 'm')).toBe('–');
  });

  it('groups by mode, higher confidence first, and lists what was not measured', () => {
    const groups = groupMetrics(uncalibrated);
    const lists = uncalibrated.configSnapshot.metrics.byMode.distance;
    expect(groups.primary.every((m) => lists.primary.includes(m.id))).toBe(true);
    expect(groups.secondary.every((m) => lists.secondary.includes(m.id))).toBe(true);
    const rank = { high: 0, medium: 1, low: 2, unavailable: 3 };
    for (const group of [groups.primary, groups.secondary]) {
      const ranks = group.map((m) => rank[m.confidence]);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
    // Speed needs a calibration: it is not a blank card but listed as not measured.
    expect(groups.notMeasured.map((m) => m.id)).toContain('speed');
    expect([...groups.primary, ...groups.secondary].some((m) => m.id === 'speed')).toBe(false);
  });

  it('names what each warning hid or lowered', () => {
    const effects = warningEffects(uncalibrated);
    const calibration = effects.find((e) => e.check === 'calibration_present');
    expect(calibration).toMatchObject({
      hidden: ['speed'],
      secondaryHidden: ['vertical_oscillation'],
      lowered: [],
    });
  });
});

const metric = (overrides: Partial<MetricResult> = {}): MetricResult => ({
  id: 'contact_time',
  value: 212.4,
  unit: 'ms',
  bySide: { left: 210.2, right: 214.9 },
  sd: 6.3,
  n: 4,
  confidence: 'medium',
  reasons: ['timing_sensitive', 'gate:fps_ok'],
  ...overrides,
});

describe('MetricCard', () => {
  it('shows the value, unit, both sides, confidence, description and reasons', () => {
    render(<MetricCard metric={metric()} />);
    const card = screen.getByRole('article', { name: 'Ground contact time' });
    expect(card).toHaveTextContent('212 ms');
    expect(card).toHaveTextContent('Left210 ms');
    expect(card).toHaveTextContent('Right215 ms');
    expect(card).toHaveTextContent('Medium confidence');
    expect(card).toHaveTextContent('How long each foot stays on the ground');
    expect(screen.getByRole('list', { name: 'Why the confidence is lower' })).toHaveTextContent(
      'A one- or two-frame error changes this value noticeably.',
    );
    expect(card).toHaveTextContent('not recorded at a high enough frame rate');
  });

  it('shows the spread when the value is tapped', async () => {
    render(<MetricCard metric={metric()} />);
    expect(screen.queryByText(/Spread ±/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /212 ms/ }));
    expect(screen.getByText('Spread ± 6 ms over 4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /212 ms/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows centimetres for vertical oscillation when calibrated', () => {
    const vo = calibrated.metrics.find((m) => m.id === 'vertical_oscillation');
    if (!vo) throw new Error('missing vertical oscillation');
    render(<MetricCard metric={vo} />);
    expect(screen.getByRole('article', { name: 'Vertical bounce' })).toHaveTextContent(
      /% of leg length.*\d+\.\d cm/,
    );
  });
});

describe('ConfidenceBadge', () => {
  it('says the level in words', () => {
    const { rerender } = render(<ConfidenceBadge confidence="high" />);
    expect(screen.getByText('High confidence')).toBeInTheDocument();
    rerender(<ConfidenceBadge confidence="low" />);
    expect(screen.getByText('Low confidence')).toBeInTheDocument();
    rerender(<ConfidenceBadge confidence="unavailable" />);
    expect(screen.getByText('Not measured')).toBeInTheDocument();
  });
});

describe('GateBanner', () => {
  it('lists each warning with what it hid, and the fix', () => {
    render(<GateBanner result={uncalibrated} />);
    expect(screen.getByRole('heading', { name: 'Passed with conditions' })).toBeInTheDocument();
    expect(screen.getByText(/There is no calibration for this clip/)).toBeInTheDocument();
    expect(screen.getByText('Not measured: Speed.')).toBeInTheDocument();
    expect(screen.getByText('Not measured in centimetres: Vertical bounce.')).toBeInTheDocument();
    expect(screen.getByText(/two markers 5 m apart/)).toBeInTheDocument();
  });

  it('shows nothing for a result without warnings', () => {
    const passed = { ...calibrated, gate: { ...calibrated.gate, status: 'pass' as const } };
    const { container } = render(<GateBanner result={passed} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('angles in the frame', () => {
  const pose = (overrides: Record<number, { x: number; y: number }>): Landmark[] => {
    const lm: Landmark[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, v: 0 }));
    for (const [i, p] of Object.entries(overrides)) lm[Number(i)] = { ...p, v: 0.99 };
    return lm;
  };
  // Standing straight, then leaning forward (to +x), drawn side-on.
  const upright = pose({
    [LM.leftShoulder]: { x: 500, y: 300 },
    [LM.rightShoulder]: { x: 500, y: 300 },
    [LM.leftHip]: { x: 500, y: 500 },
    [LM.rightHip]: { x: 500, y: 500 },
    [LM.leftKnee]: { x: 500, y: 650 },
    [LM.leftAnkle]: { x: 500, y: 800 },
    [LM.rightKnee]: { x: 560, y: 640 },
    [LM.rightAnkle]: { x: 520, y: 790 },
  });

  it('measures a straight leg as 0 and the bent one positive', () => {
    const a = frameAngles(upright, 1, 0.5);
    expect(a.knee.left).toBeCloseTo(0, 5);
    expect(a.knee.right ?? 0).toBeGreaterThan(10);
    expect(a.trunkLean).toBeCloseTo(0, 5);
    // The right ankle is behind its knee: a negative shin angle when running to +x.
    expect(a.shin.right ?? 0).toBeLessThan(0);
  });

  it('uses the direction of travel for the sign, and skips unclear points', () => {
    const leaning = pose({
      [LM.leftShoulder]: { x: 560, y: 300 },
      [LM.rightShoulder]: { x: 560, y: 300 },
      [LM.leftHip]: { x: 500, y: 500 },
      [LM.rightHip]: { x: 500, y: 500 },
    });
    expect(frameAngles(leaning, 1, 0.5).trunkLean ?? 0).toBeGreaterThan(10);
    expect(frameAngles(leaning, -1, 0.5).trunkLean ?? 0).toBeLessThan(-10);
    expect(frameAngles(leaning, 1, 0.5).knee.left).toBeNull();
    expect(frameAngles(null, 1, 0.5).trunkLean).toBeNull();
  });
});
