import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  base: process.env.VITE_BASE ?? '/',
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
} as never);
