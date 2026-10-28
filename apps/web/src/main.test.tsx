import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('web scaffold', () => {
  it('renders a React tree in jsdom', () => {
    const { container } = render(<main data-testid="root" />);
    expect(container.querySelector('main')).toBeInTheDocument();
  });
});
