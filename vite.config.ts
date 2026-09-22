import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  preview: {
    host: true,
    port: Number(process.env.PORT) || 4173,
    // No stable hostname yet (raw-IP access) — allow any Host header.
    allowedHosts: true,
  },
})
