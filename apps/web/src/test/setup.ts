import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Route tests load lazy screens on first use, which can take a few seconds in a cold worker.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
});

// jsdom has no canvas: drawing components get no context and draw nothing in unit tests. (The
// *.node.test.ts files run without a DOM.)
if (typeof HTMLCanvasElement !== 'undefined')
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: () => null });
