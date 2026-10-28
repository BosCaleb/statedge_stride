import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'analysis',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
