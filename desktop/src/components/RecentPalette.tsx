/**
 * Recent-docs palette (⌘E).
 *
 * Different from SearchPalette: no MCP query, no search field. Just a flat
 * keyboard-navigable list of the docs the user touched recently, sourced from
 * the store's persisted recentDocs[]. Pressing the same key again cycles
 * through the list (so you can ⌘E ⌘E ⌘E to jump backwards through history).
 */
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Clock, X, FileText } from '../lib/icons'
import { store, useStore } from '../store'

export function RecentPalette() {
  const open    = useStore((s) => s.recentOpen)
  const recents = useStore((s) => s.recentDocs)
  const [selected, setSelected] = useState(0)

  // Reset selection on open
  useEffect(() => { if (open) setSelected(0) }, [open])

  // Keyboard nav
  useEffect(() => {
    if (!open) return
    function handle(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); store.setRecentOpen(false); return }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelected((i) => Math.min(i + 1, recents.length - 1))
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelected((i) => Math.max(i - 1, 0))
      }
      // ⌘E while open advances selection (cycle).
      if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault()
        setSelected((i) => (i + 1) % Math.max(1, recents.length))
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const pick = recents[selected]
        if (pick) {
          store.open({
            title: pick.title,
            icon:  pick.icon,
            view:  { kind: 'doc', docId: pick.id },
          })
        }
        store.setRecentOpen(false)
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [open, recents, selected])

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center no-drag"
          style={{ background: 'rgba(0,0,0,0.32)' }}
          onClick={() => store.setRecentOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y:  0, scale: 1 }}
            exit={{    opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-[520px] max-w-[90vw] shadow-2xl"
            style={{
              background: 'var(--color-bg-strong)',
              border: '1px solid var(--color-border)',
              borderRadius: '0.5rem',
            }}
          >
            <header className="flex items-center gap-2 px-4 py-3"
                    style={{ borderBottom: '1px solid var(--color-border)' }}>
              <Clock size={14} style={{ color: 'var(--color-text-subtle)' }} />
              <span className="text-xs uppercase tracking-wider font-semibold"
                    style={{ color: 'var(--color-text-subtle)' }}>Recent docs</span>
              <span className="ml-auto text-[10px] mono"
                    style={{ color: 'var(--color-text-subtle)' }}>
                ↑↓ navigate · Enter open · Esc close
              </span>
              <button
                onClick={() => store.setRecentOpen(false)}
                className="opacity-50 hover:opacity-100"
              ><X size={14} /></button>
            </header>

            <div className="max-h-[50vh] overflow-y-auto p-1">
              {recents.length === 0 ? (
                <div className="px-4 py-8 text-sm text-center"
                     style={{ color: 'var(--color-text-subtle)' }}>
                  No recent docs yet. Open a doc, then ⌘E will show it here.
                </div>
              ) : (
                recents.map((doc, i) => (
                  <RecentRow
                    key={doc.id + ':' + doc.openedAt}
                    title={doc.title}
                    icon={doc.icon ?? '📄'}
                    when={formatRelative(doc.openedAt)}
                    selected={i === selected}
                    onClick={() => {
                      store.open({
                        title: doc.title,
                        icon:  doc.icon,
                        view:  { kind: 'doc', docId: doc.id },
                      })
                      store.setRecentOpen(false)
                    }}
                  />
                ))
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

function RecentRow({
  title, icon, when, selected, onClick,
}: {
  title: string; icon: string; when: string; selected: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2 text-left rounded"
      style={{
        background: selected ? 'var(--color-accent-soft)' : 'transparent',
        color:      selected ? 'var(--color-accent)'      : 'var(--color-text)',
      }}
    >
      <span style={{ width: 18, textAlign: 'center' }}>{icon || <FileText size={14} />}</span>
      <span className="flex-1 truncate text-sm">{title}</span>
      <span className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>{when}</span>
    </button>
  )
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms
  const s = Math.floor(diff / 1000)
  if (s < 60)  return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60)  return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)  return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7)   return `${d}d ago`
  return new Date(ms).toLocaleDateString()
}
