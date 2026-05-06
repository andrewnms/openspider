/**
 * Per-block context menu — SiYuan-style.
 *
 * Hovering a block surfaces a faint `…` handle to its left; clicking that
 * (or right-clicking the block body) opens a menu with: Turn into → /
 * Insert above / Insert below / Make flashcard / Copy → / Block attrs / Delete.
 *
 * We deliberately do NOT modify BlockNote's own SideMenu — fighting its
 * internal positioning logic isn't worth the bug surface. Instead this
 * overlay watches `[data-id]` block elements (BlockNote's stable DOM
 * attribute) and floats our handle/menu at their geometry. The menu uses
 * the editor's public API (insertBlocks / updateBlock / removeBlocks)
 * which is fully supported even when SideMenu is left untouched.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  MoreHorizontal, Plus, Trash2, Copy, FileText, Link2,
  FileQuestion, Bookmark, Edit3, ChevronRight,
} from '../lib/icons'
import { useActiveEditor } from '../lib/editorBus'

type BlockType =
  | 'paragraph' | 'heading' | 'bulletListItem' | 'numberedListItem'
  | 'checkListItem' | 'codeBlock' | 'quote'

const TURN_INTO: { type: BlockType; label: string; props?: Record<string, unknown> }[] = [
  { type: 'paragraph',         label: 'Paragraph' },
  { type: 'heading',           label: 'H1', props: { level: 1 } },
  { type: 'heading',           label: 'H2', props: { level: 2 } },
  { type: 'heading',           label: 'H3', props: { level: 3 } },
  { type: 'bulletListItem',    label: 'Bulleted list' },
  { type: 'numberedListItem',  label: 'Numbered list' },
  { type: 'checkListItem',     label: 'To-do' },
  { type: 'codeBlock',         label: 'Code block' },
  { type: 'quote',             label: 'Quote' },
]

type Pos = { x: number; y: number }

export function BlockMenuOverlay() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = useActiveEditor() as any
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [hoverGeom, setHoverGeom] = useState<{ left: number; top: number; height: number } | null>(null)
  const [menu, setMenu] = useState<{ blockId: string; pos: Pos } | null>(null)
  const [submenu, setSubmenu] = useState<'turn' | 'copy' | null>(null)
  const submenuTimer = useRef<number | null>(null)

  // Track hovered block via mouseover bubbling. We DON'T mount per-block
  // listeners — way too many for a long doc. Capture-phase delegation on
  // the document handles every case.
  useEffect(() => {
    if (!editor) { setHoverId(null); return }
    function onMove(e: MouseEvent) {
      const t = e.target as HTMLElement | null
      if (!t) return
      const blockEl = t.closest('[data-id]') as HTMLElement | null
      if (!blockEl) { setHoverId(null); setHoverGeom(null); return }
      const id = blockEl.getAttribute('data-id')
      if (!id) return
      const r = blockEl.getBoundingClientRect()
      // Anchor handle slightly outside the block's left edge.
      setHoverId(id)
      setHoverGeom({ left: r.left - 28, top: r.top + 4, height: r.height })
    }
    function onLeave(e: MouseEvent) {
      // Only clear if cursor leaves the editor host entirely (allow moving
      // to the floating handle / menu without flicker).
      const t = e.relatedTarget as HTMLElement | null
      if (!t || !t.closest('.bn-host, [data-block-overlay]')) {
        setHoverId(null); setHoverGeom(null)
      }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseout', onLeave)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseout', onLeave)
    }
  }, [editor])

  // Right-click on a block → open menu at cursor (SiYuan parity).
  useEffect(() => {
    if (!editor) return
    function onContext(e: MouseEvent) {
      const t = e.target as HTMLElement | null
      const blockEl = t?.closest('[data-id]') as HTMLElement | null
      if (!blockEl) return
      const id = blockEl.getAttribute('data-id'); if (!id) return
      // Don't hijack right-clicks inside selectable text — only on non-text
      // chrome. Allow the user to still get the browser's spell-check menu
      // when they're cursor-on-a-word.
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed) return
      e.preventDefault()
      setMenu({ blockId: id, pos: { x: e.clientX, y: e.clientY } })
      setSubmenu(null)
    }
    document.addEventListener('contextmenu', onContext)
    return () => document.removeEventListener('contextmenu', onContext)
  }, [editor])

  // Close menu on outside click / Escape.
  useEffect(() => {
    if (!menu) return
    function onDown(e: MouseEvent) {
      const t = e.target as HTMLElement | null
      if (t?.closest('[data-block-menu]')) return
      setMenu(null); setSubmenu(null)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setMenu(null); setSubmenu(null) }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  /* ─────── Block ops via the editor's public API ─────── */

  function getBlock(id: string) {
    if (!editor) return null
    try { return editor.getBlock(id) } catch { return null }
  }
  function turnInto(id: string, type: BlockType, props?: Record<string, unknown>) {
    const b = getBlock(id); if (!b) return
    try { editor.updateBlock(id, { type, props: { ...(b.props ?? {}), ...(props ?? {}) } }) }
    catch (e) { console.warn('turnInto failed', e) }
  }
  function insertNeighbor(id: string, side: 'before' | 'after') {
    if (!editor) return
    try { editor.insertBlocks([{ type: 'paragraph' }], id, side) }
    catch (e) { console.warn('insertBlocks failed', e) }
  }
  function deleteBlock(id: string) {
    if (!editor) return
    try { editor.removeBlocks([id]) }
    catch (e) { console.warn('removeBlocks failed', e) }
  }
  function copyBlock(id: string, mode: 'markdown' | 'plain' | 'id') {
    const b = getBlock(id); if (!b) return
    if (mode === 'id') {
      navigator.clipboard.writeText(id).catch(() => {})
      window.dispatchEvent(new CustomEvent('os:toast', { detail: 'Copied block ID' }))
      return
    }
    try {
      if (mode === 'markdown') {
        editor.blocksToMarkdownLossy([b]).then((md: string) => {
          navigator.clipboard.writeText(md).catch(() => {})
          window.dispatchEvent(new CustomEvent('os:toast', { detail: 'Copied block as Markdown' }))
        })
        return
      }
      // plain — strip markdown punctuation, keep readable text
      editor.blocksToMarkdownLossy([b]).then((md: string) => {
        const plain = md
          .replace(/```[\s\S]*?```/g, '')
          .replace(/[`*_~>#-]+/g, '')
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
          .replace(/\n{3,}/g, '\n\n').trim()
        navigator.clipboard.writeText(plain).catch(() => {})
        window.dispatchEvent(new CustomEvent('os:toast', { detail: 'Copied block as plain text' }))
      })
    } catch (e) { console.warn('copyBlock failed', e) }
  }

  /* ─────── Render ─────── */

  if (!editor) return null

  return (
    <>
      {/* Floating handle on hover */}
      <AnimatePresence>
        {hoverId && hoverGeom && (
          <motion.button
            data-block-overlay
            key="handle"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.10 }}
            onClick={(e) => {
              e.stopPropagation()
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setMenu({ blockId: hoverId, pos: { x: r.right + 4, y: r.bottom + 4 } })
              setSubmenu(null)
            }}
            title="Block menu"
            className="fixed grid place-items-center"
            style={{
              left: hoverGeom.left,
              top: hoverGeom.top,
              width: 22, height: 22,
              borderRadius: 4,
              background: 'transparent',
              color: 'var(--color-text-subtle)',
              zIndex: 40,
            }}
          >
            <MoreHorizontal size={14} />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Menu */}
      <AnimatePresence>
        {menu && (
          <BlockMenu
            pos={menu.pos}
            block={getBlock(menu.blockId)}
            blockId={menu.blockId}
            submenu={submenu}
            setSubmenu={setSubmenu}
            holdRef={submenuTimer}
            onTurnInto={(type, props) => { turnInto(menu.blockId, type, props); setMenu(null) }}
            onInsertAbove={() => { insertNeighbor(menu.blockId, 'before'); setMenu(null) }}
            onInsertBelow={() => { insertNeighbor(menu.blockId, 'after');  setMenu(null) }}
            onDelete={() => { deleteBlock(menu.blockId); setMenu(null) }}
            onCopy={(mode) => { copyBlock(menu.blockId, mode); setMenu(null) }}
            onClose={() => { setMenu(null); setSubmenu(null) }}
          />
        )}
      </AnimatePresence>
    </>
  )
}

function BlockMenu({
  pos, block, blockId, submenu, setSubmenu, holdRef,
  onTurnInto, onInsertAbove, onInsertBelow, onDelete, onCopy,
}: {
  pos: Pos
  block: { type?: string; id?: string } | null
  blockId: string
  submenu: 'turn' | 'copy' | null
  setSubmenu: (s: 'turn' | 'copy' | null) => void
  holdRef: React.MutableRefObject<number | null>
  onTurnInto: (type: BlockType, props?: Record<string, unknown>) => void
  onInsertAbove: () => void
  onInsertBelow: () => void
  onDelete: () => void
  onCopy: (mode: 'markdown' | 'plain' | 'id') => void
  onClose: () => void
}) {
  const idShort = useMemo(() => blockId.slice(0, 8), [blockId])
  function hover(s: 'turn' | 'copy' | null) {
    if (holdRef.current) clearTimeout(holdRef.current)
    setSubmenu(s)
  }
  function leave() {
    holdRef.current = window.setTimeout(() => setSubmenu(null), 120)
  }
  return (
    <motion.div
      data-block-menu
      initial={{ opacity: 0, y: -4, scale: 0.97 }}
      animate={{ opacity: 1, y: 0,  scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.97 }}
      transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
      onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
      className="fixed z-[100] w-56 py-1 shadow-xl"
      style={{
        left: pos.x, top: pos.y,
        background: 'var(--color-bg-strong)',
        border: '1px solid var(--color-border)',
        borderRadius: '0.5rem',
      }}
    >
      <Header>{block?.type ?? 'block'} · {idShort}</Header>

      {/* Turn into → submenu */}
      <div data-block-menu className="relative"
           onMouseEnter={() => hover('turn')} onMouseLeave={leave}>
        <Row icon={<Edit3 size={13} />} label="Turn into"
             right={<ChevronRight size={11} />} onClick={() => setSubmenu(submenu === 'turn' ? null : 'turn')} />
        {submenu === 'turn' && (
          <Submenu>
            {TURN_INTO.map((t, i) => (
              <Row
                key={i}
                icon={<span className="text-[11px] mono">{t.label.slice(0, 2)}</span>}
                label={t.label}
                onClick={() => onTurnInto(t.type, t.props)}
              />
            ))}
          </Submenu>
        )}
      </div>

      <Row icon={<Plus size={13} />} label="Insert above" onClick={onInsertAbove} />
      <Row icon={<Plus size={13} />} label="Insert below" onClick={onInsertBelow} />

      <Divider />

      {/* Copy → submenu */}
      <div data-block-menu className="relative"
           onMouseEnter={() => hover('copy')} onMouseLeave={leave}>
        <Row icon={<Copy size={13} />} label="Copy"
             right={<ChevronRight size={11} />} onClick={() => setSubmenu(submenu === 'copy' ? null : 'copy')} />
        {submenu === 'copy' && (
          <Submenu>
            <Row icon={<FileText size={13} />}     label="As Markdown" onClick={() => onCopy('markdown')} />
            <Row icon={<Link2 size={13} />}        label="Plain text"  onClick={() => onCopy('plain')} />
            <Row icon={<FileQuestion size={13} />} label="Block ID"    sub={blockId} onClick={() => onCopy('id')} />
          </Submenu>
        )}
      </div>

      <Row icon={<Bookmark size={13} />} label="Make flashcard"
           sub="Promotes this doc to the review queue"
           onClick={() => {
             // Block-level cards aren't a thing yet — promote the whole doc.
             window.dispatchEvent(new CustomEvent('os:make-flashcard'))
           }} />

      <Row icon={<Edit3 size={13} />} label="Attributes…"
           sub="Bookmark / Aliases / Memo / Custom"
           onClick={() => {
             // The doc-attrs panel is doc-scoped (block-scoped attrs need
             // stable block IDs across markdown round-trips, which BlockNote
             // doesn't preserve). For now this opens the doc's attr modal.
             window.dispatchEvent(new CustomEvent('os:open-attrs'))
           }} />

      <Divider />

      <Row icon={<Trash2 size={13} />} label="Delete block" shortcut="⌫" onClick={onDelete} danger />
    </motion.div>
  )
}

function Submenu({ children }: { children: React.ReactNode }) {
  return (
    <div data-block-menu
         className="absolute left-full top-0 ml-1 w-56 py-1 shadow-xl"
         style={{
           background: 'var(--color-bg-strong)',
           border: '1px solid var(--color-border)',
           borderRadius: '0.5rem',
         }}>
      {children}
    </div>
  )
}

function Header({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-1.5 pb-1 text-[10px] uppercase tracking-wider font-semibold mono"
         style={{ color: 'var(--color-text-subtle)' }}>
      {children}
    </div>
  )
}
function Divider() {
  return <div className="my-1" style={{ borderTop: '1px solid var(--color-border-soft)' }} />
}
function Row({
  icon, label, sub, right, shortcut, onClick, danger,
}: {
  icon: React.ReactNode; label: string
  sub?: string; right?: React.ReactNode; shortcut?: string
  onClick: () => void; danger?: boolean
}) {
  return (
    <button
      data-block-menu
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-[var(--color-border-soft)]"
      style={{ color: danger ? 'var(--color-danger)' : 'var(--color-text)' }}
    >
      <span className="shrink-0 w-4 grid place-items-center"
            style={{ color: danger ? 'var(--color-danger)' : 'var(--color-text-subtle)' }}>
        {icon}
      </span>
      <span className="flex-1 min-w-0 truncate">
        <span>{label}</span>
        {sub && (
          <span className="block text-[10px] mono truncate"
                style={{ color: 'var(--color-text-subtle)' }}>{sub}</span>
        )}
      </span>
      {shortcut && (
        <span className="text-[10px] mono shrink-0"
              style={{ color: 'var(--color-text-subtle)' }}>{shortcut}</span>
      )}
      {right && <span className="shrink-0" style={{ color: 'var(--color-text-subtle)' }}>{right}</span>}
    </button>
  )
}
