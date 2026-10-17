// Vitest-setup för komponenttester: lägger till jest-dom-matchers (toBeInTheDocument m.fl.)
// och städar DOM mellan testerna.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
