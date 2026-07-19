import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://localhost:3001'
    },
    watch: {
      // avoid ENOSPC (file watcher limit) from large non-frontend trees
      ignored: [
        '**/.venv/**',
        '**/.claude/**',
        '**/dist/**',
        '**/assets/**',
        '**/__pycache__/**',
        '**/*.png',
      ],
    },
  },
});
