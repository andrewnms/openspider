/**
 * Workspace switcher dropdown for the TitleBar.
 *
 * Shows the active vault name with a chevron; click expands a small panel
 * listing recent vaults + an "Open another workspace…" action. The actual
 * vault-switch wiring (which requires the Tauri kernel to swap its mount
 * point) lands later — this component owns the UI surface so the rest of
 * the chrome reads complete.
 */
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { ChevronDown, Folder, Plus, Check } from '../lib/icons'
import { invoke } from '@tauri-apps/api/core'

const RECENTS_KEY = 'os.workspace.recents'
const ACTIVE_KEY  = 'os.workspace.active'

type Workspace = { name: string; path: string }

export function WorkspaceSwitcher() {
  const [open, setOpen]     = useState(false)
  const [active, setActive] = useState<Workspace | null>(null)
  const [recents, setRecents] = useState<Workspace[]>(() => loadRecents())
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const stored = localStorage.getItem(ACTIVE_KEY)
    if (stored) {
      try { setActive(JSON.parse(stored) as Workspace); return } catch { /* */ }
    }
    invoke<string>('get_vault_path').then((path) => {
      const ws = { name: nameFromPath(path), path }
      setActive(ws)
      try { localStorage.setItem(ACTIVE_KEY, JSON.stringify(ws)) } catch { /* */ }
    }).catch(() => {
      setActive({ name: 'Local vault', path: '~/Library/Application Support/OpenSpider/vault' })
    })
  }, [])

  // close on outside click / escape
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 h-7 px-2 text-sm font-medium rounded hover:bg-[var(--color-border-soft)]"
        style={{ color: 'var(--color-text)' }}
        title={active?.path}
      >
        <span style={{ fontSize: 14, lineHeight: 1 }}>🕷</span>
        <span className="truncate max-w-[160px]">{active?.name ?? 'Workspace'}</span>
        <ChevronDown size={12} style={{ color: 'var(--color-text-subtle)' }} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y:  0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
            className="absolute top-full left-0 mt-1 w-72 z-50 shadow-xl"
            style={{
              background: 'var(--color-bg-strong)',
              border: '1px solid var(--color-border)',
              borderRadius: '0.5rem',
            }}
          >
            <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider font-semibold"
                 style={{ color: 'var(--color-text-subtle)' }}>Workspaces</div>

            <div className="px-1 pb-1">
              {/* Active */}
              {active && (
                <Row
                  workspace={active}
                  active
                  onClick={() => setOpen(false)}
                />
              )}
              {/* Recents (excluding active) */}
              {recents
                .filter((r) => r.path !== active?.path)
                .map((r) => (
                  <Row
                    key={r.path}
                    workspace={r}
                    onClick={() => {
                      setActive(r)
                      try { localStorage.setItem(ACTIVE_KEY, JSON.stringify(r)) } catch { /* */ }
                      setOpen(false)
                      // Real switch requires kernel reload — show a hint until we wire it.
                      // (No-op for now; user data stays in current vault.)
                    }}
                  />
                ))}
            </div>

            <div className="border-t my-1" style={{ borderColor: 'var(--color-border-soft)' }} />

            <button
              onClick={() => {
                // Stub — Tauri dialog plugin will land in a follow-up. For now
                // just nudge users about the planned location.
                const path = window.prompt('Folder path for new workspace:')
                if (!path) return
                const ws = { name: nameFromPath(path), path }
                setRecents((rs) => {
                  const next = [ws, ...rs.filter((r) => r.path !== path)].slice(0, 8)
                  saveRecents(next); return next
                })
                setActive(ws)
                try { localStorage.setItem(ACTIVE_KEY, JSON.stringify(ws)) } catch { /* */ }
                setOpen(false)
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--color-border-soft)]"
              style={{ color: 'var(--color-text)' }}
            >
              <Plus size={13} style={{ color: 'var(--color-text-subtle)' }} />
              Open another workspace…
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Row({ workspace, active, onClick }: {
  workspace: Workspace; active?: boolean; onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-2 rounded text-left hover:bg-[var(--color-border-soft)]"
      style={{ background: active ? 'var(--color-accent-soft)' : 'transparent' }}
    >
      <Folder size={13} style={{ color: active ? 'var(--color-accent)' : 'var(--color-text-subtle)' }} />
      <div className="flex-1 min-w-0">
        <div className="text-sm" style={{ color: active ? 'var(--color-accent)' : 'var(--color-text)' }}>
          {workspace.name}
        </div>
        <div className="text-[10px] mono truncate" style={{ color: 'var(--color-text-subtle)' }}>
          {workspace.path}
        </div>
      </div>
      {active && <Check size={13} style={{ color: 'var(--color-accent)' }} />}
    </button>
  )
}

/* ────────── helpers ────────── */

function nameFromPath(p: string): string {
  // Last non-empty segment, capitalised. /Users/kko/Library/.../OpenSpider/vault → Vault.
  const parts = p.replace(/\/+$/, '').split('/')
  const last = parts[parts.length - 1] || p
  return last.charAt(0).toUpperCase() + last.slice(1)
}
function loadRecents(): Workspace[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    if (!raw) return []
    return JSON.parse(raw)
  } catch { return [] }
}
function saveRecents(list: Workspace[]) {
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(list)) } catch { /* */ }
}
