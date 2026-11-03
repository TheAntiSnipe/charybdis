import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // amazon-cognito-identity-js expects a Node-style `global`
  define: { global: 'globalThis' },
  build: { outDir: 'dist', sourcemap: false },
});
