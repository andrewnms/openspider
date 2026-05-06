/**
 * Doc history modal — list snapshots, preview, restore.
 *
 * Snapshots are captured server-side every time content changes (with a
 * 60s throttle per doc). The list is newest-first; selecting a snapshot
 * loads its body into a read-only preview pane. Hitting Restore writes
 * the snapshot back as the current content; the existing live content
 * is itself snapshotted first so the restore is reversible.
 */
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Clock, X, RefreshCw } from '../lib/icons'
import { k } from '../lib/mcp'
import { appConfirm } from '../lib/dialog'

export function HistoryPanel({
  docId, docTitle, onClose, onRestored,
}: {
  docId: string
  docTitle: string
  onClose: () => void
  /** Called after a successful restore so the parent can refetch. */
  onRestored: () => void
}) {
  const [stamps,   setStamps]   = useState<string[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [body,     setBody]     = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    let cancelled = false
    k.listDocHistory(docId).then((r) => {
      if (cancelled) return
      setStamps(r.items)
      if (r.items.length > 0) setSelected(r.items[0])
    }).catch(() => { if (!cancelled) setStamps([]) })
    return () => { cancelled = true }
  }, [docId])

  useEffect(() => {
    if (!selected) { setBody(null); return }
    let cancelled = false
    k.getDocSnapshot(docId, selected).then((r) => {
      if (!cancelled) setBody(r.content)
    }).catch(() => { if (!cancelled) setBody('(snapshot unavailable)') })
    return () => { cancelled = true }
  }, [docId, selected])

  async function restore() {
    if (!selected) return
    if (!await appConfirm(`Restore "${docTitle}" to this snapshot?\n\n${formatStamp(selected)}\n\nThe current version will be saved as a new snapshot first.`)) return
    setRestoring(true)
    try {
      await k.restoreDocSnapshot(docId, selected)
      onRestored()
      onClose()
    } catch (e) {
      console.error('restore failed', e)
    } finally {
      setRestoring(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className="fixed inset-0 z-[150] grid place-items-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, y: 8 }}
        transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="w-[860px] max-w-[92vw] h-[640px] max-h-[88vh] flex flex-col shadow-2xl"
        style={{
          background: 'var(--color-bg-strong)',
          border: '1px solid var(--color-border)',
          borderRadius: 12,
        }}
      >
        <header className="px-5 py-3 flex items-center gap-3 shrink-0"
                style={{ borderBottom: '1px solid var(--color-border)' }}>
          <Clock size={16} style={{ color: 'var(--color-text-subtle)' }} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate">{docTitle}</div>
            <div className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>
              {stamps === null ? 'Loading…' :
               stamps.length === 0 ? 'No snapshots yet — they appear after edits.' :
               `${stamps.length} snapshot${stamps.length === 1 ? '' : 's'}`}
            </div>
          </div>
          <button onClick={onClose}
                  className="w-7 h-7 grid place-items-center rounded hover:bg-[var(--color-border-soft)]"
                  style={{ color: 'var(--color-text-muted)' }}>
            <X size={14} />
          </button>
        </header>

        <div className="flex-1 grid grid-cols-[240px_1fr] min-h-0">
          {/* List */}
          <div className="overflow-y-auto py-2"
               style={{ borderRight: '1px solid var(--color-border)' }}>
            {stamps?.length === 0 && (
              <div className="px-4 py-6 text-xs" style={{ color: 'var(--color-text-subtle)' }}>
                Edits to this doc are auto-snapshotted (max one per minute).
                Once you make a change, the first version will appear here.
              </div>
            )}
            {stamps?.map((s) => (
              <motion.button
                key={s}
                onClick={() => setSelected(s)}
                whileHover={{ x: 2 }}
                transition={{ duration: 0.08 }}
                className="w-full text-left px-4 py-2"
                style={{
                  background: s === selected ? 'var(--color-accent-soft)' : 'transparent',
                  color: s === selected ? 'var(--color-accent)' : 'var(--color-text)',
                }}
              >
                <div className="text-sm">{formatStamp(s)}</div>
                <div className="text-[10px] mono mt-0.5"
                     style={{ color: 'var(--color-text-subtle)' }}>
                  {relativeTime(s)}
                </div>
              </motion.button>
            ))}
          </div>

          {/* Preview */}
          <div className="overflow-y-auto p-5">
            {body === null ? (
              <div className="text-xs" style={{ color: 'var(--color-text-subtle)' }}>
                {stamps && stamps.length === 0 ? 'No snapshots to preview.' : 'Loading…'}
              </div>
            ) : (
              <pre className="whitespace-pre-wrap text-sm leading-relaxed mono"
                   style={{ color: 'var(--color-text)' }}>
                {body}
              </pre>
            )}
          </div>
        </div>

        <footer className="px-5 py-3 flex items-center gap-3 shrink-0"
                style={{ borderTop: '1px solid var(--color-border)' }}>
          <span className="text-[11px] flex-1" style={{ color: 'var(--color-text-subtle)' }}>
            Restoring will save the current version as a new snapshot first.
          </span>
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            transition={{ duration: 0.08 }}
            onClick={restore}
            disabled={!selected || restoring}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--color-accent)' }}
          >
            <RefreshCw size={13} />
            {restoring ? 'Restoring…' : 'Restore'}
          </motion.button>
        </footer>
      </motion.div>
    </motion.div>
  )
}

/** Wrapper-with-AnimatePresence so the consumer doesn't have to. */
export function HistoryPanelHost(props: {
  open: boolean
  docId: string
  docTitle: string
  onClose: () => void
  onRestored: () => void
}) {
  return (
    <AnimatePresence>
      {props.open && (
        <HistoryPanel
          docId={props.docId}
          docTitle={props.docTitle}
          onClose={props.onClose}
          onRestored={props.onRestored}
        />
      )}
    </AnimatePresence>
  )
}

function formatStamp(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}

function relativeTime(iso: string): string {
  try {
    const then = new Date(iso).getTime()
    const diff = Date.now() - then
    const m = Math.floor(diff / 60_000)
    if (m < 1)   return 'just now'
    if (m < 60)  return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24)  return `${h}h ago`
    const d = Math.floor(h / 24)
    return `${d}d ago`
  } catch { return '' }
}
