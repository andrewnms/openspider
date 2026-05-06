/// <reference types="vite/client" />

// Build-time stamp injected via vite.config.ts `define`. Used by the boot
// diagnostic in main.tsx to confirm the WKWebView is loading the latest bundle.
declare const __BUILD_AT__: string
