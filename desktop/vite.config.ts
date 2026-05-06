import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Tauri runs `npm run dev` and points its WebView at this dev server.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
  base: './',
  define: {
    // Short stamp baked into the bundle so the boot diagnostic can prove the
    // WKWebView is loading THIS build (not a stale cache).
    __BUILD_AT__: JSON.stringify(
      new Date().toLocaleTimeString('en-US', { hour12: false }),
    ),
  },
  build: {
    // Vite 8 + Rolldown's automatic chunk splitting was producing a React
    // chunk whose CJS-interop helper got tree-shaken out → runtime
    // `TypeError: e is not a function` when the main bundle tried to call it.
    // Inline everything into a single bundle. We pay a slightly larger
    // initial download but Tauri loads from disk so it's instant.
    rollupOptions: {
      output: {
        manualChunks: undefined,
        inlineDynamicImports: true,
      },
    },
    chunkSizeWarningLimit: 5000,
  },
})
