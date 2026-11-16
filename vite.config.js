import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({ build: { rollupOptions: { input: {
  album: resolve(process.cwd(), 'index.html'),
  preparation: resolve(process.cwd(), 'preparation/index.html'),
} } } });
