import { defineConfig } from 'vitest/config';

// Test av Edge Functions rena logik (handler.ts). handler.ts är ren TypeScript utan Deno-anrop,
// så den körs i Node. index.ts (som importerar Deno/npm-specifiers) importeras ALDRIG av testerna.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['**/*.test.ts'],
  },
});
