import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // amazon-cognito-identity-js expects a Node-style `global`
  define: { global: 'globalThis' },
  build: { outDir: 'dist', sourcemap: false },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'] },
});
