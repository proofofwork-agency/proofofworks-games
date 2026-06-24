import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5174,
    open: true,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
});
