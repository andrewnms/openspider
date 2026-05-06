import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './lib/ErrorBoundary'

// ── Pre-React diagnostics ────────────────────────────────────────────────
// If the bundle never finishes evaluating, you'd see a blank window with no
// console (WKWebView prod builds don't surface JS errors anywhere visible).
// We drop a fixed status pill into <body> so we can tell *where* execution
// died: pill present + no app = React mount failed; pill missing = bundle
// never executed at all. The pill is removed once React finishes rendering.
const debugEl = document.createElement('div')
debugEl.id = '__os_boot__'
debugEl.style.cssText =
  'position:fixed;top:8px;right:8px;z-index:99999;padding:6px 10px;' +
  'font:11px/1.2 ui-monospace,monospace;background:#1c1917;color:#fff;' +
  'border-radius:4px;pointer-events:none;opacity:0.85'
// Build stamp lets us tell at a glance whether the WKWebView loaded the new
// bundle vs. an old cached one.
const BUILD_STAMP = (typeof __BUILD_AT__ !== 'undefined') ? __BUILD_AT__ : 'dev'
debugEl.textContent = `OS · booting… (${BUILD_STAMP})`
document.body.appendChild(debugEl)

// Surface any uncaught error visibly so the user can copy/paste it back.
function showError(label: string, msg: string) {
  debugEl.style.background = '#dc2626'
  debugEl.style.opacity   = '1'
  debugEl.textContent     = `OS · ${label}: ${msg.slice(0, 200)}`
}
window.addEventListener('error', (e) => {
  showError('runtime err', e.message || String(e))
})
window.addEventListener('unhandledrejection', (e) => {
  showError('promise err', String(e.reason ?? 'unknown'))
})

try {
  const root = document.getElementById('root')
  if (!root) throw new Error('#root element missing from index.html')

  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )

  // After the first paint we know React mounted. Pull down the no-JS HTML
  // fallback (now we know JS works), then keep the pill briefly so the
  // user can confirm the boot sequence completed, then fade it out.
  requestAnimationFrame(() => {
    document.getElementById('boot-fallback')?.remove()
    debugEl.textContent = `OS · live (${BUILD_STAMP})`
    debugEl.style.background = '#16a34a'
    setTimeout(() => debugEl.remove(), 2000)
  })
} catch (e) {
  showError('mount err', e instanceof Error ? e.message : String(e))
  throw e
}
