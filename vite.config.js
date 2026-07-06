// Import Vite's helper so this file gets editor/type support for config keys.
import { defineConfig } from 'vite'
// Enable React JSX transformation and fast refresh during local development.
import react from '@vitejs/plugin-react'
// Enable Tailwind v4's Vite-native CSS processing pipeline.
import tailwindcss from '@tailwindcss/vite'

// Keep the build configuration intentionally small: this is a pure client app.
export default defineConfig({
  // Run React first for JSX/HMR, then Tailwind so CSS utilities are generated.
  plugins: [react(), tailwindcss()],
})
