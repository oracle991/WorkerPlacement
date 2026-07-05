import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/WorkerPlacement/',
  server: {
    port: 5173,
  },
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
  },
});
