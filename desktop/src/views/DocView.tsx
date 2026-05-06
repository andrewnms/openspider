import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { MoreHorizontal, Copy, FileText, Link2, FileQuestion } from '../lib/icons'
import { k, type Doc } from '../lib/mcp'
import { MarkdownEditor } from '../components/MarkdownEditor'

export function DocView({ docId }: { docId: string }) {
  const [doc, setDoc] = useState<Doc | null>(null)
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError]   = useState<string | null>(null)
  const [copyMenu, setCopyMenu] = useState(false)
  const [copyToast, setCopyToast] = useState<string | null>(null)
  const dirtyRef = useRef(false)
  const titleRef = useRef('')
  const menuRef  = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!docId) { setError('No doc selected. Pick one in the sidebar or use New doc.'); return }
    let alive = true
    setError(null)
    Promise.all([k.getDoc(docId), k.getDocContent(docId)]).then(([d, html]) => {
      if (!alive) return
      setDoc(d); titleRef.current = d.title
      setContent(htmlToMd(typeof html === 'string' ? html : ''))
    }).catch((e) => { if (alive) setError(e?.message ?? String(e)) })
    return () => { alive = false }
  }, [docId])

  // Click-outside / Esc to close the copy menu.
  useEffect(() => {
    if (!copyMenu) return
    function onDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as globalThis.Node)) setCopyMenu(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setCopyMenu(false) }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [copyMenu])

  if (error) return (
    <div className="p-12" style={{ color: 'var(--color-text-muted)' }}>
      <div className="text-sm mb-2">⚠ Couldn't load doc.</div>
      <div className="text-xs mono" style={{ color: 'var(--color-text-subtle)' }}>{error}</div>
    </div>
  )

  useEffect(() => {
    if (!doc || !dirtyRef.current) return
    const t = setTimeout(async () => {
      setSaving('saving'); await k.updateDocContent(doc.id, content)
      setSaving('saved'); setTimeout(() => setSaving('idle'), 1200)
      dirtyRef.current = false
    }, 600)
    return () => clearTimeout(t)
  }, [content, doc])

  if (!doc) return <div className="p-8" style={{ color: 'var(--color-text-subtle)' }}>Loading…</div>

  // Copy actions — write to clipboard + show a tiny toast for confirmation.
  async function copy(label: string, text: string) {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopyToast(`Copied ${label}`)
      setTimeout(() => setCopyToast(null), 1200)
    } catch (e) {
      console.error('clipboard write failed', e)
    }
    setCopyMenu(false)
  }

  return (
    <div className="h-full overflow-auto px-12 py-10" style={{ background: 'var(--color-bg-strong)' }}>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-baseline gap-3 mb-2">
          <span className="text-3xl">{doc.icon ?? '📄'}</span>
          <input
            defaultValue={titleRef.current}
            onChange={(e) => { titleRef.current = e.target.value }}
            onBlur={async (e) => {
              if (e.target.value === doc.title) return
              const updated = await k.updateDoc(doc.id, { title: e.target.value })
              setDoc(updated)
            }}
            className="flex-1 text-3xl font-bold bg-transparent border-none outline-none selectable"
            placeholder="Untitled"
          />

          {/* "More" menu — owns the doc-level Copy submenu (#129 doc-scope).
             Block-level Copy actions land later when we rebuild BlockNote's
             side menu. */}
          <div ref={menuRef} className="relative shrink-0">
            <motion.button
              onClick={() => setCopyMenu((v) => !v)}
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.92 }}
              transition={{ duration: 0.08 }}
              title="More…"
              className="w-8 h-8 grid place-items-center rounded hover:bg-[var(--color-border-soft)]"
              style={{ color: 'var(--color-text-muted)' }}
            >
              <MoreHorizontal size={16} />
            </motion.button>

            <AnimatePresence>
              {copyMenu && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0,  scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.97 }}
                  transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute right-0 top-full mt-1 w-56 z-30 shadow-xl"
                  style={{
                    background: 'var(--color-bg-strong)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '0.5rem',
                  }}
                >
                  <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider font-semibold"
                       style={{ color: 'var(--color-text-subtle)' }}>Copy</div>
                  <CopyRow
                    icon={<FileText size={14} />}
                    label="As Markdown"
                    sub="Full doc with formatting"
                    onClick={() => copy('Markdown', `# ${doc.title}\n\n${content}`)}
                  />
                  <CopyRow
                    icon={<Copy size={14} />}
                    label="Plain text"
                    sub="Strip markdown punctuation"
                    onClick={() => copy('plain text', stripMd(content))}
                  />
                  <CopyRow
                    icon={<Link2 size={14} />}
                    label="As wiki-link"
                    sub={`[[${doc.title}]]`}
                    onClick={() => copy('wiki-link', `[[${doc.title}]]`)}
                  />
                  <div className="border-t my-1" style={{ borderColor: 'var(--color-border-soft)' }} />
                  <CopyRow
                    icon={<FileQuestion size={14} />}
                    label="Doc ID"
                    sub={doc.id}
                    onClick={() => copy('doc ID', doc.id)}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="text-xs mb-6" style={{ color: 'var(--color-text-subtle)' }}>
          Doc · {saving === 'saving' ? 'Saving…' : saving === 'saved' ? '✓ Saved' : ''}
        </div>

        <MarkdownEditor
          value={content}
          onChange={(md) => { dirtyRef.current = true; setContent(md) }}
          placeholder="Start writing… (try [[Page Name]] for wiki links)"
        />
      </div>

      {/* Toast — bottom-right pop on copy actions */}
      <AnimatePresence>
        {copyToast && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.12 }}
            className="fixed bottom-12 right-6 z-50 px-3 py-2 text-xs font-medium shadow-lg"
            style={{
              background: 'var(--color-text)',
              color:      'var(--color-bg-strong)',
              borderRadius: '0.5rem',
            }}
          >
            ✓ {copyToast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function CopyRow({
  icon, label, sub, onClick,
}: { icon: React.ReactNode; label: string; sub?: string; onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ x: 2 }}
      transition={{ duration: 0.08 }}
      className="w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-[var(--color-border-soft)]"
    >
      <span style={{ color: 'var(--color-text-subtle)', marginTop: 2 }}>{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm" style={{ color: 'var(--color-text)' }}>{label}</div>
        {sub && (
          <div className="text-[11px] truncate mono" style={{ color: 'var(--color-text-subtle)' }}>
            {sub}
          </div>
        )}
      </div>
    </motion.button>
  )
}

function htmlToMd(html: string): string {
  return html
    .replace(/<\/h([1-6])>/g, '\n').replace(/<h1[^>]*>/g, '# ').replace(/<h2[^>]*>/g, '## ').replace(/<h3[^>]*>/g, '### ')
    .replace(/<\/p>/g, '\n\n').replace(/<p[^>]*>/g, '').replace(/<br\s*\/?>/g, '\n')
    .replace(/<li[^>]*>/g, '- ').replace(/<\/li>/g, '\n').replace(/<\/?(ul|ol)[^>]*>/g, '')
    .replace(/<strong>(.*?)<\/strong>/g, '**$1**').replace(/<em>(.*?)<\/em>/g, '*$1*')
    .replace(/<code>(.*?)<\/code>/g, '`$1`').replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n').trim()
}

function stripMd(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#*_~>]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
