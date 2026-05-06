/**
 * Doc attributes panel — Bookmark, Aliases, Memo + custom key/value rows.
 *
 * State lives in the doc's YAML frontmatter, so attributes survive across
 * sessions and any external editor opening the .md file. The backend
 * exposes get/update via s16_get_doc_attrs / s16_update_doc_attrs (a
 * generic merge — set a key to null to remove). We keep the structured
 * fields explicit (Bookmark / Aliases / Memo) and let "Custom keys" be a
 * free-form table for anything else (e.g. fund-stage tagging, project
 * codes — whatever the user invents).
 */
import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Bookmark, Tag, FileQuestion, X, Plus, Trash2 } from '../lib/icons'
import { k } from '../lib/mcp'

const STRUCTURED_KEYS = new Set([
  'id', 'title', 'icon', 'parentId', 'createdAt', 'updatedAt',
  'isArchived', 'isPublic', 'shareId', 'position',
  'flashcard', 'cardDue', 'cardInterval', 'cardEase',
  'bookmark', 'aliases', 'memo',
])

export function AttrsPanel({ docId, onClose }: { docId: string; onClose: () => void }) {
  const [attrs, setAttrs] = useState<Record<string, unknown> | null>(null)
  const [bookmark, setBookmark] = useState(false)
  const [memo, setMemo] = useState('')
  const [aliases, setAliases] = useState<string[]>([])
  const [aliasDraft, setAliasDraft] = useState('')
  const [customKey, setCustomKey] = useState('')
  const [customVal, setCustomVal] = useState('')

  useEffect(() => {
    let cancelled = false
    k.getDocAttrs(docId).then((a) => {
      if (cancelled) return
      setAttrs(a)
      setBookmark(Boolean(a.bookmark))
      setMemo(typeof a.memo === 'string' ? a.memo : '')
      setAliases(Array.isArray(a.aliases) ? a.aliases.map(String) : [])
    }).catch(() => { if (!cancelled) setAttrs({}) })
    return () => { cancelled = true }
  }, [docId])

  const customEntries = useMemo(() =>
    Object.entries(attrs ?? {}).filter(([k]) => !STRUCTURED_KEYS.has(k)),
    [attrs],
  )

  async function patch(extra: Record<string, unknown>) {
    const next = await k.updateDocAttrs(docId, extra)
    // Update the local mirror with the server response shape (camelCase
    // version of what's now in frontmatter) so subsequent edits are based
    // on truth, not stale state.
    const fresh = await k.getDocAttrs(docId)
    setAttrs(fresh)
    return next
  }

  async function addAlias() {
    const v = aliasDraft.trim(); if (!v) return
    const next = [...aliases, v]
    setAliases(next); setAliasDraft('')
    await patch({ aliases: next })
  }
  async function removeAlias(i: number) {
    const next = aliases.filter((_, j) => j !== i)
    setAliases(next)
    await patch({ aliases: next.length > 0 ? next : null })
  }
  async function addCustom() {
    const k_ = customKey.trim(); if (!k_) return
    if (STRUCTURED_KEYS.has(k_)) return
    setCustomKey(''); setCustomVal('')
    await patch({ [k_]: customVal })
  }
  async function removeCustom(key: string) { await patch({ [key]: null }) }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className="fixed inset-0 z-[150] grid place-items-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, y: 8 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 8 }}
        transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="w-[560px] max-w-[92vw] max-h-[88vh] overflow-y-auto shadow-2xl"
        style={{
          background: 'var(--color-bg-strong)',
          border: '1px solid var(--color-border)',
          borderRadius: 12,
        }}
      >
        <header className="px-5 py-3 flex items-center gap-3 sticky top-0"
                style={{ background: 'var(--color-bg-strong)', borderBottom: '1px solid var(--color-border)' }}>
          <Tag size={16} style={{ color: 'var(--color-text-subtle)' }} />
          <div className="flex-1">
            <div className="text-sm font-semibold">Attributes</div>
            <div className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>
              Bookmark · Aliases · Memo · custom keys. Stored in the doc's frontmatter.
            </div>
          </div>
          <button onClick={onClose}
                  className="w-7 h-7 grid place-items-center rounded hover:bg-[var(--color-border-soft)]"
                  style={{ color: 'var(--color-text-muted)' }}>
            <X size={14} />
          </button>
        </header>

        <div className="p-5 space-y-5">
          {/* Bookmark */}
          <Section title="Bookmark" icon={<Bookmark size={13} />}>
            <button
              onClick={async () => {
                const v = !bookmark
                setBookmark(v)
                await patch({ bookmark: v ? true : null })
              }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm"
              style={{
                background: bookmark ? 'var(--color-accent-soft)' : 'var(--color-bg-soft)',
                color: bookmark ? 'var(--color-accent)' : 'var(--color-text)',
                border: '1px solid ' + (bookmark ? 'var(--color-accent)' : 'var(--color-border)'),
              }}
            >
              <Bookmark size={13} />
              {bookmark ? 'Bookmarked' : 'Add bookmark'}
            </button>
          </Section>

          {/* Aliases */}
          <Section title="Aliases" icon={<Tag size={13} />}>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {aliases.length === 0 && (
                <div className="text-xs italic" style={{ color: 'var(--color-text-subtle)' }}>
                  Alternate titles for search + wiki-link resolution.
                </div>
              )}
              {aliases.map((a, i) => (
                <span key={i}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-xs"
                      style={{ background: 'var(--color-bg-soft)', border: '1px solid var(--color-border)' }}>
                  {a}
                  <button onClick={() => removeAlias(i)}
                          className="opacity-50 hover:opacity-100"
                          style={{ color: 'var(--color-text-muted)' }}>
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
            <form className="flex gap-2"
                  onSubmit={(e) => { e.preventDefault(); addAlias() }}>
              <input
                value={aliasDraft}
                onChange={(e) => setAliasDraft(e.target.value)}
                placeholder="Type an alias and hit Enter…"
                className="flex-1 text-xs px-2 py-1.5 rounded outline-none"
                style={{
                  background: 'var(--color-bg-soft)', color: 'var(--color-text)',
                  border: '1px solid var(--color-border)',
                }}
              />
              <button type="submit"
                      className="text-xs px-2 py-1.5 rounded font-medium text-white"
                      style={{ background: 'var(--color-accent)' }}>
                <Plus size={11} />
              </button>
            </form>
          </Section>

          {/* Memo */}
          <Section title="Memo" icon={<FileQuestion size={13} />}>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              onBlur={async () => { await patch({ memo: memo.trim() || null }) }}
              placeholder="Free-form note that lives in frontmatter, not the body."
              className="w-full text-sm px-3 py-2 rounded outline-none mono"
              style={{
                background: 'var(--color-bg-soft)', color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
                minHeight: 70, resize: 'vertical',
              }}
            />
          </Section>

          {/* Custom */}
          <Section title="Custom" icon={<Plus size={13} />}>
            {customEntries.length > 0 && (
              <div className="space-y-1 mb-2">
                {customEntries.map(([key, val]) => (
                  <div key={key}
                       className="flex items-center gap-2 px-2 py-1.5 rounded text-xs"
                       style={{ background: 'var(--color-bg-soft)', border: '1px solid var(--color-border)' }}>
                    <span className="mono font-medium shrink-0" style={{ color: 'var(--color-accent)' }}>
                      {key}
                    </span>
                    <span className="flex-1 truncate" style={{ color: 'var(--color-text)' }}>
                      {typeof val === 'string' ? val : JSON.stringify(val)}
                    </span>
                    <button onClick={() => removeCustom(key)}
                            className="opacity-50 hover:opacity-100"
                            style={{ color: 'var(--color-danger)' }}>
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <form className="flex gap-2"
                  onSubmit={(e) => { e.preventDefault(); addCustom() }}>
              <input
                value={customKey}
                onChange={(e) => setCustomKey(e.target.value)}
                placeholder="key"
                className="w-32 text-xs px-2 py-1.5 rounded outline-none mono"
                style={{
                  background: 'var(--color-bg-soft)', color: 'var(--color-text)',
                  border: '1px solid var(--color-border)',
                }}
              />
              <input
                value={customVal}
                onChange={(e) => setCustomVal(e.target.value)}
                placeholder="value"
                className="flex-1 text-xs px-2 py-1.5 rounded outline-none"
                style={{
                  background: 'var(--color-bg-soft)', color: 'var(--color-text)',
                  border: '1px solid var(--color-border)',
                }}
              />
              <button type="submit"
                      className="text-xs px-2 py-1.5 rounded font-medium text-white"
                      style={{ background: 'var(--color-accent)' }}>
                <Plus size={11} />
              </button>
            </form>
          </Section>
        </div>
      </motion.div>
    </motion.div>
  )
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2 text-[11px] uppercase tracking-wider font-semibold"
           style={{ color: 'var(--color-text-subtle)' }}>
        <span>{icon}</span>
        <span>{title}</span>
      </div>
      {children}
    </div>
  )
}

export function AttrsPanelHost({
  open, docId, onClose,
}: { open: boolean; docId: string; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && <AttrsPanel docId={docId} onClose={onClose} />}
    </AnimatePresence>
  )
}
