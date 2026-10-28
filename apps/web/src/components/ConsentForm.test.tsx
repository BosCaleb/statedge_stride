import type { Athlete } from '@stride/shared/api/athletes';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConsentForm } from './ConsentForm';

const base: Athlete = {
  id: '6a1f8f3c-2d6e-4b7a-a0f4-3e5a9d1c7b22',
  firstName: 'Lerato',
  lastName: 'Molefe',
  birthYear: 2012,
  externalRef: null,
  createdAt: '2026-03-01T10:00:00.000Z',
  consents: { analysis: null, sharing: null, clip_storage: null },
};

describe('ConsentForm', () => {
  it('asks a parent or guardian for a minor, and keeps verbal and digital evidence off', () => {
    render(<ConsentForm athlete={base} today="2026-03-14" onSubmit={() => undefined} />);
    expect(screen.getByText(/18 or younger this year/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'The athlete' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'A parent or guardian' })).toBeChecked();
    expect(screen.getByRole('radio', { name: /verbally/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Digital/ })).toBeDisabled();
  });

  it('records one consent per chosen purpose', async () => {
    const onSubmit = vi.fn();
    render(<ConsentForm athlete={base} today="2026-03-14" onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText('Name of the person consenting'), 'Grace Molefe');
    await userEvent.type(screen.getByLabelText('Relationship to the athlete'), 'Mother');
    await userEvent.click(screen.getByRole('button', { name: 'Save consent' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const puts = onSubmit.mock.calls[0]?.[0] as {
      purpose: string;
      givenBy: string;
      relationship: string | null;
    }[];
    expect(puts.map((p) => p.purpose)).toEqual(['analysis', 'sharing']);
    expect(puts.every((p) => p.givenBy === 'guardian' && p.relationship === 'Mother')).toBe(true);
  });

  it('needs a name and at least one purpose', async () => {
    const onSubmit = vi.fn();
    render(<ConsentForm athlete={base} today="2026-03-14" onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /Analysing/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Sharing/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save consent' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Choose at least one purpose.');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the name of the person consenting.');
  });

  it('lets an adult consent verbally, with their own name filled in', async () => {
    const onSubmit = vi.fn();
    const adult = { ...base, birthYear: 2000 };
    render(<ConsentForm athlete={adult} today="2026-03-14" onSubmit={onSubmit} />);
    expect(screen.getByLabelText('Name of the person consenting')).toHaveValue('Lerato Molefe');
    await userEvent.click(screen.getByRole('radio', { name: /verbally/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save consent' }));
    expect(onSubmit.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ givenBy: 'athlete', evidence: 'verbal', givenOn: '2026-03-14' }),
      ]),
    );
  });

  it('leaves out purposes that already have consent', () => {
    const consented = {
      ...base,
      consents: {
        ...base.consents,
        analysis: {
          id: '1c3b5d7f-9a2b-4c6d-8e0f-1a2b3c4d5e6f',
          athleteId: base.id,
          purpose: 'analysis' as const,
          givenBy: 'guardian' as const,
          givenByName: 'Grace Molefe',
          relationship: 'Mother',
          evidence: 'paper_form' as const,
          givenOn: '2026-03-01',
          recordedBy: '2c3b5d7f-9a2b-4c6d-8e0f-1a2b3c4d5e6f',
          recordedAt: '2026-03-01T10:00:00.000Z',
          withdrawnAt: null,
        },
      },
    };
    render(<ConsentForm athlete={consented} today="2026-03-14" onSubmit={() => undefined} />);
    expect(screen.queryByRole('checkbox', { name: /Analysing/ })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Sharing/ })).toBeChecked();
  });
});
