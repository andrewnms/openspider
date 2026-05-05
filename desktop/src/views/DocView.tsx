import { useEffect, useState, useRef } from 'react'
import { k, type Doc } from '../lib/mcp'
import { MarkdownEditor } from '../components/MarkdownEditor'

export function DocView({ docId }: { docId: string }) {
  const [doc, setDoc] = useState<Doc | null>(null)
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle')
  const dirtyRef = useRef(false)
  const titleRef = useRef('')

  useEffect(() => {
    let alive = true
    Promise.all([k.getDoc(docId), k.getDocContent(docId)]).then(([d, html]) => {
      if (!alive) return
      setDoc(d); titleRef.current = d.title
      setContent(htmlToMd(typeof html === 'string' ? html : ''))
    })
    return () => { alive = false }
  }, [docId])

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
            className="flex-1 text-3xl font-bold bg-transparent border-none outline-none"
            placeholder="Untitled"
          />
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
    </div>
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
