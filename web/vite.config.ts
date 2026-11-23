import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // In dev, the React app (5173) forwards API calls to the Express server (3000).
    // In production, Express serves the built app, so there is one origin and no CORS.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
