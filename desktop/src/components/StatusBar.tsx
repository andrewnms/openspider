/**
 * Bottom status bar: live document stats + dock toggle.
 *
 * Subscribes to the editor bus; recomputes stats whenever the active doc
 * changes. The stats render only when there *is* an active editor — for
 * non-doc views (Home / Database / Agents / etc.) the bar still shows the
 * dock toggle and a faint workspace label.
 */
import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { Sidebar as DockIcon, SidebarOpen as DockOpenIcon } from '../lib/icons'
import { store, useStore } from '../store'
import { useActiveEditor, useEditorTick } from '../lib/editorBus'

export function StatusBar() {
  const dockVisible = useStore((s) => s.dockVisible)
  const editor = useActiveEditor()
  const tick   = useEditorTick()

  // Pull the markdown asynchronously, but cheaply — recompute on every tick.
  // Both call paths (Tiptap-style sync `getMarkdown` and BlockNote-style async
  // `blocksToMarkdownLossy`) are wrapped because the editor may be in a torn-
  // down state mid-tab-switch and either method can throw or return a non-
  // thenable. We swallow + render '' rather than crash the whole status bar.
  const [md, setMd] = useState<string>('')
  useEffect(() => {
    let cancelled = false
    if (!editor) { setMd(''); return }

    // Path 1: Tiptap-style `editor.storage.markdown.getMarkdown()` returns
    // a string synchronously.
    try {
      const sync = (editor as { storage?: { markdown?: { getMarkdown?: () => string } } })
        ?.storage?.markdown?.getMarkdown?.()
      if (typeof sync === 'string') { setMd(sync); return }
    } catch { /* fall through to BlockNote path */ }

    // Path 2: BlockNote-style. Guard every step — the function might be
    // missing, might throw before returning, or might return a non-Promise.
    try {
      const fn = (editor as { blocksToMarkdownLossy?: () => unknown }).blocksToMarkdownLossy
      if (typeof fn !== 'function') return
      const result = fn.call(editor)
      if (result && typeof (result as Promise<string>).then === 'function') {
        (result as Promise<string>)
          .then((s) => { if (!cancelled) setMd(typeof s === 'string' ? s : '') })
          .catch(() => { if (!cancelled) setMd('') })
      } else if (typeof result === 'string') {
        setMd(result)
      }
    } catch { setMd('') }

    return () => { cancelled = true }
  }, [editor, tick])

  const stats = useMemo(() => computeStats(md, editor), [md, editor])

  return (
    <footer
      className="h-9 shrink-0 flex items-center text-[12px] gap-2 px-4 select-none"
      style={{
        background: 'var(--color-bg-soft)',
        borderTop: '1px solid var(--color-border)',
        color: 'var(--color-text-muted)',
      }}
    >
      {/* Single dock toggle: hides BOTH activity rails + their panels. */}
      <Btn
        title={dockVisible ? 'Hide dock' : 'Show dock'}
        onClick={() => store.toggleDock()}
      >
        {dockVisible ? <DockIcon size={12} /> : <DockOpenIcon size={12} />}
      </Btn>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right: live stats — only shown when an editor is active */}
      {editor && (
        <div className="flex items-center gap-5 mono">
          <Stat label="Characters" value={stats.characters} />
          <Stat label="Words"      value={stats.words} />
          <Stat label="Links"      value={stats.links} />
          <Stat label="Refs"       value={stats.refs} />
          <Stat label="Blocks"     value={stats.blocks} />
        </div>
      )}
    </footer>
  )
}

function Btn({
  children, title, onClick,
}: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <motion.button
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.92 }}
      transition={{ duration: 0.08 }}
      title={title}
      onClick={onClick}
      className="w-6 h-6 grid place-items-center rounded hover:bg-[var(--color-border-soft)]"
      style={{ color: 'var(--color-text-muted)' }}
    >
      {children}
    </motion.button>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex items-center gap-1">
      <span style={{ color: 'var(--color-text-subtle)' }}>{label}</span>
      <span style={{ color: 'var(--color-text)', fontWeight: 500 }}>{value.toLocaleString()}</span>
    </span>
  )
}

/* ────────── stat math ────────── */

function computeStats(md: string, editor: unknown): {
  characters: number; words: number; links: number; refs: number; blocks: number
} {
  // Strip markdown tokens to get a "human-text" view for character/word counts.
  // (Keeps numbers comparable with the editor view of the doc.)
  const plain = md
    .replace(/`{1,3}[^`]*`{1,3}/g, ' ')   // code fences/inline
    .replace(/!\[[^\]]*\]\([^)]*\)/g,' ') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → label
    .replace(/[#>*_~`]/g, '')             // markdown punctuation
    .replace(/\s+/g, ' ')
    .trim()
  const characters = plain.length
  const words      = plain ? plain.split(/\s+/).filter(Boolean).length : 0

  // Link count: standard `[label](url)` plus bare http URLs.
  const linkMatches = md.match(/\[[^\]]*\]\([^)]*\)|https?:\/\/\S+/g)
  const links = linkMatches ? linkMatches.length : 0

  // Refs: SiYuan-style `((blockId))` and Obsidian-style `[[Title]]`.
  const refMatches = md.match(/\(\([^)]+\)\)|\[\[[^\]]+\]\]/g)
  const refs = refMatches ? refMatches.length : 0

  let blocks = 0
  try {
    const doc = (editor as { document?: unknown[] })?.document
    if (Array.isArray(doc)) blocks = doc.length
  } catch { /* */ }

  return { characters, words, links, refs, blocks }
}
