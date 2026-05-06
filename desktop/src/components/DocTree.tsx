/**
 * Hierarchical doc tree for the sidebar.
 *
 * Builds the tree client-side from the flat list returned by `k.listAllDocs()`.
 * Each node supports expand/collapse, click-to-open, hover affordances
 * (`+` new child, `…` overflow), right-click context menu (SiYuan-style),
 * and **drag-and-drop with triangulation** — drag onto top 25% / middle 50%
 * / bottom 25% of a row to reorder above / nest into / reorder below. Drop
 * on the empty root zone to detach to top-level.
 *
 * Sibling order is persisted via the `position` field on each doc. When the
 * user drags or uses "Create above/below", the entire affected sibling group
 * is renumbered 0..N-1 in parallel — single source of truth, no fractional
 * drift. For a sidebar with O(10s) of siblings this is effectively free.
 *
 * Persisted UI state: which parent IDs are expanded. Lives in localStorage
 * under `os.docTree.expanded` so the tree feels like it remembers you.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  ChevronRight, FileText, Plus, MoreHorizontal, Trash2, Edit3, FolderInput,
  Copy, Link2, FileQuestion, ArrowRight,
} from '../lib/icons'
import { k, type Doc } from '../lib/mcp'
import { store } from '../store'
import { appPrompt, appConfirm } from '../lib/dialog'

const EXPANDED_KEY = 'os.docTree.expanded'
const DRAG_MIME    = 'application/x-openspider-doc'

type Node = Doc & { children: Node[] }

type DropPos = 'above' | 'into' | 'below'
type DropIndicator = { id: string; pos: DropPos } | { id: 'root'; pos: 'into' } | null

export function DocTree({ activeTabId, refreshTick }: {
  activeTabId: string | null
  refreshTick: number
}) {
  const [docs, setDocs] = useState<Doc[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpanded())
  // Active drag — null when nothing's being dragged. We mirror this in a ref
  // so DOM event handlers see the latest value without stale closures.
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [drop, setDrop] = useState<DropIndicator>(null)
  const draggedIdRef = useRef<string | null>(null)
  draggedIdRef.current = draggedId

  useEffect(() => {
    k.listAllDocs().then(setDocs).catch(() => setDocs([]))
  }, [refreshTick])

  const tree = useMemo(() => buildTree(docs), [docs])

  // Index of descendant ids per node — pre-computed so onDragOver can decide
  // "can I drop here?" in O(1) without walking the tree each time.
  const descendantsOf = useMemo(() => indexDescendants(tree), [tree])

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      saveExpanded(next)
      return next
    })
  }

  async function createSub(parent: Doc | null) {
    const title = await appPrompt(parent ? `New sub-doc under "${parent.title}"?` : 'Doc title?')
    if (!title) return
    const created = await k.createDoc(title, {
      icon: '📄',
      ...(parent ? { parentId: parent.id } : {}),
    })
    if (parent) {
      setExpanded((prev) => {
        const next = new Set(prev); next.add(parent.id); saveExpanded(next); return next
      })
    }
    setDocs((xs) => [...xs, created])
    store.open({ title: created.title, icon: created.icon, view: { kind: 'doc', docId: created.id } })
  }

  /** "Create doc above/below" — like createSub but inserts as a *sibling*
   *  of `target` at the requested side, then renumbers the sibling group so
   *  the new doc lands exactly above/below visually. */
  async function createSibling(target: Doc, side: 'above' | 'below') {
    const title = await appPrompt(`New doc ${side} "${target.title}"?`)
    if (!title) return
    const parentId = target.parentId ?? null
    const created = await k.createDoc(title, {
      icon: '📄',
      ...(parentId ? { parentId } : {}),
    })
    setDocs((xs) => {
      const next = [...xs, created]
      // Build the new ordered list of siblings and stamp positions.
      const siblings = orderedSiblingsAfterInsert(next, parentId, target.id, created.id, side)
      reorderInBackground(siblings)
      return next.map((d) => {
        const idx = siblings.findIndex((s) => s.id === d.id)
        return idx >= 0 ? { ...d, position: idx } : d
      })
    })
    store.open({ title: created.title, icon: created.icon, view: { kind: 'doc', docId: created.id } })
  }

  async function rename(doc: Doc) {
    const title = await appPrompt('New title?', doc.title)
    if (!title || title === doc.title) return
    const updated = await k.updateDoc(doc.id, { title })
    setDocs((xs) => xs.map((d) => d.id === doc.id ? { ...d, ...updated } : d))
  }

  async function duplicate(doc: Doc) {
    const dup = await k.duplicateDoc(doc.id).catch(() => null)
    if (!dup) return
    setDocs((xs) => [...xs, dup])
  }

  async function moveToRoot(doc: Doc) {
    if (!doc.parentId) return
    await k.moveDoc(doc.id, null)
    setDocs((xs) => xs.map((d) => d.id === doc.id ? { ...d, parentId: null } : d))
  }

  async function remove(doc: Doc) {
    if (!await appConfirm(`Delete "${doc.title}"? This cannot be undone.`, { danger: true })) return
    await k.deleteDoc(doc.id)
    setDocs((xs) => xs.filter((d) => d.id !== doc.id && d.parentId !== doc.id))
  }

  /** Renumber a sibling group (positions 0..N-1) on the backend, in parallel.
   *  Fire-and-forget; the local optimistic state already reflects the order. */
  function reorderInBackground(orderedSiblings: Doc[]) {
    Promise.all(
      orderedSiblings.map((d, i) => {
        if (d.position === i) return null // already correct, skip the call
        return k.moveDoc(d.id, d.parentId ?? null, i).catch((e) => {
          console.error('[doctree] reorder failed for', d.title, e)
        })
      }),
    ).then(() => console.log('[doctree] reorder ✓', orderedSiblings.map((d) => d.title)))
  }

  /** Move `draggedId` under `targetParentId`. If `pos` is given, also place
   *  the doc at that sibling slot (above/into/below relative to `targetId`). */
  async function performMove(
    targetParentId: string | null,
    pos: 'above' | 'into' | 'below' = 'into',
    relativeToId?: string,
  ) {
    const id = draggedIdRef.current
    if (!id) { console.warn('[doctree] performMove: no draggedId'); return }
    if (id === targetParentId) { console.warn('[doctree] performMove: self-target'); return }
    if (targetParentId && descendantsOf.get(id)?.has(targetParentId)) {
      console.warn('[doctree] performMove: would create cycle', { id, targetParentId })
      return
    }
    console.log('[doctree] performMove', { id, targetParentId, pos, relativeToId })
    if (targetParentId) {
      setExpanded((prev) => {
        const next = new Set(prev); next.add(targetParentId); saveExpanded(next); return next
      })
    }

    // Sibling reorder (above/below): renumber the WHOLE group in parallel.
    if (pos !== 'into' && relativeToId) {
      setDocs((xs) => {
        const next = xs.map((d) => d.id === id ? { ...d, parentId: targetParentId } : d)
        const siblings = orderedSiblingsAfterInsert(next, targetParentId, relativeToId, id, pos)
        reorderInBackground(siblings)
        return next.map((d) => {
          const idx = siblings.findIndex((s) => s.id === d.id)
          return idx >= 0 ? { ...d, position: idx } : d
        })
      })
      return
    }

    // Plain "into" move (or move-to-root) — just flip the parent.
    setDocs((xs) => xs.map((d) => d.id === id ? { ...d, parentId: targetParentId } : d))
    try {
      const updated = await k.moveDoc(id, targetParentId)
      console.log('[doctree] performMove ✓', updated)
    } catch (e) {
      console.error('[doctree] performMove failed', e)
      k.listAllDocs().then(setDocs).catch(() => {})
    }
  }

  function isValidTarget(targetId: string): boolean {
    const id = draggedIdRef.current
    if (!id || id === targetId) return false
    return !descendantsOf.get(id)?.has(targetId)
  }

  /** Translate a drop position on a target row into the resulting parent id.
   *  - 'into'  → become a CHILD of the target
   *  - 'above'/'below' → become a SIBLING of the target (parent = target.parentId) */
  function resolveDropParent(target: Doc, pos: DropPos): string | null {
    if (pos === 'into')  return target.id
    return target.parentId ?? null
  }

  function onRootDragOver(e: React.DragEvent) {
    // Same fix as onDragOverRow — detect our drag via dataTransfer.types
    // rather than the (potentially-stale) ref / state.
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDrop({ id: 'root', pos: 'into' })
  }
  async function onRootDrop(e: React.DragEvent) {
    e.preventDefault()
    setDrop(null)
    const id = e.dataTransfer.getData(DRAG_MIME) || draggedIdRef.current
    if (!id) return
    await performMove(null)
    setDraggedId(null)
  }

  return (
    // No wrapper-level onDragLeave — that was firing on every move between
    // rows (dragleave bubbles in browsers) and racing with onDragOver, which
    // sometimes left `drop` as null exactly when the drop fired. We clear
    // `drop` only on dragend (which always fires after a drag completes,
    // success or cancel) and at the start of each new dragover.
    <div>
      {tree.map((n) => (
        <NodeRow
          key={n.id}
          node={n}
          depth={0}
          activeTabId={activeTabId}
          expanded={expanded}
          draggedId={draggedId}
          drop={drop}
          onToggle={toggle}
          onCreateSub={createSub}
          onCreateSibling={createSibling}
          onRename={rename}
          onMoveToRoot={moveToRoot}
          onDuplicate={duplicate}
          onDelete={remove}
          onDragStart={(id) => {
            // Update the ref *synchronously* so onValidateTarget can run on
            // the very first dragover (before React commits the state).
            draggedIdRef.current = id
            setDraggedId(id)
          }}
          onDragEnd={() => {
            draggedIdRef.current = null
            setDraggedId(null)
            setDrop(null)
          }}
          onSetDrop={setDrop}
          onValidateTarget={isValidTarget}
          onPerformMove={performMove}
          onResolveDropParent={resolveDropParent}
        />
      ))}

      {/* Root drop zone — drag here to detach a doc to top-level.
         Doubles as the "New doc" affordance when nothing's being dragged. */}
      <div
        onDragOver={onRootDragOver}
        onDrop={onRootDrop}
        style={{
          background: drop?.id === 'root' ? 'var(--color-accent-soft)' : 'transparent',
          outline:    drop?.id === 'root' ? '1px dashed var(--color-accent)' : 'none',
          borderRadius: 6,
          marginTop: 4,
        }}
      >
        <button
          onClick={() => createSub(null)}
          className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-md text-sm hover:bg-[var(--color-border-soft)]"
          style={{ color: 'var(--color-text-subtle)' }}
        >
          <Plus size={14} />
          <span>{draggedId ? 'Drop here for top-level' : 'New doc'}</span>
        </button>
      </div>
    </div>
  )
}

function NodeRow({
  node, depth, activeTabId, expanded, draggedId, drop,
  onToggle, onCreateSub, onCreateSibling, onRename, onMoveToRoot, onDuplicate, onDelete,
  onDragStart, onDragEnd, onSetDrop, onValidateTarget, onPerformMove, onResolveDropParent,
}: {
  node: Node
  depth: number
  activeTabId: string | null
  expanded: Set<string>
  draggedId: string | null
  drop: DropIndicator
  onToggle:        (id: string) => void
  onCreateSub:     (parent: Doc) => void
  onCreateSibling: (target: Doc, side: 'above' | 'below') => void
  onRename:        (doc: Doc) => void
  onMoveToRoot:    (doc: Doc) => void
  onDuplicate:     (doc: Doc) => void
  onDelete:        (doc: Doc) => void
  onDragStart:     (id: string) => void
  onDragEnd:       () => void
  onSetDrop:       (d: DropIndicator) => void
  onValidateTarget:(id: string) => boolean
  onPerformMove:   (
    targetParentId: string | null,
    pos?: 'above' | 'into' | 'below',
    relativeToId?: string,
  ) => Promise<void>
  onResolveDropParent: (target: Doc, pos: DropPos) => string | null
}) {
  const [hover, setHover] = useState(false)
  const [menu, setMenu]   = useState<{ x: number; y: number } | null>(null)
  const rowRef = useRef<HTMLDivElement>(null)

  const id = JSON.stringify({ kind: 'doc', docId: node.id })
  const active = activeTabId === id
  const isOpen = expanded.has(node.id)
  const hasChildren = node.children.length > 0
  const indent = 6 + depth * 18

  const isDragging   = draggedId === node.id
  const myDrop       = drop && drop.id === node.id ? drop.pos : null
  const showInto     = myDrop === 'into'
  const showAbove    = myDrop === 'above'
  const showBelow    = myDrop === 'below'

  function onDragStartRow(e: React.DragEvent) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(DRAG_MIME, node.id)
    // Replace the browser's default ghost (which looks like a generic file
    // upload) with a slim styled pill that says "I'm reorganising, not
    // importing." We render it offscreen, set it as the drag image, then let
    // the next tick clean it up.
    const pill = makeDragPill(node.title, node.icon)
    document.body.appendChild(pill)
    e.dataTransfer.setDragImage(pill, 12, 14)
    setTimeout(() => pill.remove(), 0)
    onDragStart(node.id)
  }
  function onDragOverRow(e: React.DragEvent) {
    // Detect our drag via dataTransfer.types (set synchronously at
    // dragstart) — not the React `draggedId` prop, which lags. Without
    // preventDefault on dragover, the browser silently refuses the drop.
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return
    e.preventDefault()
    e.stopPropagation()
    if (!onValidateTarget(node.id)) {
      e.dataTransfer.dropEffect = 'none'
      return
    }
    e.dataTransfer.dropEffect = 'move'
    // TRIANGULATION — the row splits into three hit zones based on cursor Y:
    //   top 30%    → 'above'  (insert as sibling above target)
    //   middle 40% → 'into'   (nest as child of target)
    //   bottom 30% → 'below'  (insert as sibling below target)
    // The middle zone is wider than the edges so "make child" stays the
    // dominant gesture; the edges are still big enough (≈9px on a 30px row)
    // to hit comfortably for in-between drops.
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const ratio = (e.clientY - r.top) / r.height
    const pos: DropPos = ratio < 0.30 ? 'above' : ratio > 0.70 ? 'below' : 'into'
    onSetDrop({ id: node.id, pos })
  }
  async function onDropRow(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!draggedId || !onValidateTarget(node.id)) {
      console.warn('[doctree] drop rejected', { draggedId, target: node.id })
      onSetDrop(null); onDragEnd()
      return
    }
    // Compute the drop position from cursor Y at drop time — not from React
    // state, which may be a tick behind. Reading the geometry every time
    // sidesteps the well-known dragover→drop-in-the-same-task race.
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const ratio = (e.clientY - r.top) / r.height
    const pos: DropPos = ratio < 0.30 ? 'above' : ratio > 0.70 ? 'below' : 'into'
    const targetParent = onResolveDropParent(node, pos)
    console.log('[doctree] drop', { draggedId, target: node.id, pos, targetParent })
    onSetDrop(null)
    await onPerformMove(targetParent, pos, node.id)
    onDragEnd()
  }

  return (
    <div>
      {/* Indicator line: drop ABOVE this row */}
      {showAbove && <DropLine indent={indent} />}

      <div
        ref={rowRef}
        draggable
        onDragStart={onDragStartRow}
        onDragEnd={onDragEnd}
        onDragOver={onDragOverRow}
        onDrop={onDropRow}
        className="group relative flex items-center w-full rounded-md hover:bg-[var(--color-border-soft)]"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => { setHover(false); setMenu(null) }}
        style={{
          background:
            showInto    ? 'var(--color-accent-soft)' :
            active      ? 'var(--color-accent-soft)' :
            'transparent',
          outline: showInto ? '1px solid var(--color-accent)' : 'none',
          opacity: isDragging ? 0.35 : 1,
          minHeight: 30,
          cursor: 'pointer',
        }}
      >
        {/* Disclosure caret */}
        <button
          onClick={(e) => { e.stopPropagation(); if (hasChildren) onToggle(node.id) }}
          className="shrink-0 grid place-items-center w-5 h-7"
          style={{ marginLeft: indent, color: 'var(--color-text-subtle)' }}
        >
          {hasChildren && (
            <ChevronRight
              size={13}
              className="transition-transform"
              style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
            />
          )}
        </button>

        <button
          onClick={() => store.open({ title: node.title, icon: node.icon, view: { kind: 'doc', docId: node.id } })}
          onContextMenu={(e) => {
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY })
          }}
          className="flex items-center gap-2 flex-1 py-1.5 text-left min-w-0"
          style={{
            color: active ? 'var(--color-accent)' : 'var(--color-text)',
            fontWeight: active ? 500 : 400,
          }}
        >
          <span style={{ width: 16, display: 'inline-block', textAlign: 'center', flexShrink: 0 }}>
            {node.icon ?? <FileText size={13} />}
          </span>
          <span className="flex-1 truncate text-sm">{node.title}</span>

          {hasChildren && !hover && (
            <span
              className="text-[11px] mono shrink-0 mr-1"
              style={{ color: 'var(--color-text-subtle)' }}
            >
              {node.children.length}
            </span>
          )}
        </button>

        {hover && !draggedId && (
          <div className="flex items-center pr-1 gap-0.5 shrink-0">
            <motion.button
              whileHover={{ scale: 1.15 }}
              whileTap={{ scale: 0.92 }}
              transition={{ duration: 0.08 }}
              onClick={(e) => { e.stopPropagation(); onCreateSub(node) }}
              title="New sub-doc"
              className="w-5 h-5 grid place-items-center rounded hover:bg-[var(--color-bg-strong)]"
              style={{ color: 'var(--color-text-subtle)' }}
            >
              <Plus size={12} />
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.15 }}
              whileTap={{ scale: 0.92 }}
              transition={{ duration: 0.08 }}
              onClick={(e) => {
                e.stopPropagation()
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setMenu({ x: r.right, y: r.bottom + 4 })
              }}
              title="More"
              className="w-5 h-5 grid place-items-center rounded hover:bg-[var(--color-bg-strong)]"
              style={{ color: 'var(--color-text-subtle)' }}
            >
              <MoreHorizontal size={12} />
            </motion.button>
          </div>
        )}

        {menu && (
          <NodeMenu
            doc={node}
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
            onCreateAbove={() => { onCreateSibling(node, 'above'); setMenu(null) }}
            onCreateBelow={() => { onCreateSibling(node, 'below'); setMenu(null) }}
            onCreateSub={()   => { onCreateSub(node); setMenu(null) }}
            onRename={()      => { onRename(node); setMenu(null) }}
            onDuplicate={()   => { onDuplicate(node); setMenu(null) }}
            onMoveToRoot={node.parentId ? () => { onMoveToRoot(node); setMenu(null) } : undefined}
            onDelete={()      => { onDelete(node); setMenu(null) }}
          />
        )}
      </div>

      {/* Indicator line: drop BELOW this row */}
      {showBelow && <DropLine indent={indent} />}

      <AnimatePresence initial={false}>
        {isOpen && hasChildren && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: 'hidden' }}
          >
            {node.children.map((c) => (
              <NodeRow
                key={c.id}
                node={c}
                depth={depth + 1}
                activeTabId={activeTabId}
                expanded={expanded}
                draggedId={draggedId}
                drop={drop}
                onToggle={onToggle}
                onCreateSub={onCreateSub}
                onCreateSibling={onCreateSibling}
                onRename={onRename}
                onMoveToRoot={onMoveToRoot}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onSetDrop={onSetDrop}
                onValidateTarget={onValidateTarget}
                onPerformMove={onPerformMove}
                onResolveDropParent={onResolveDropParent}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ────────── NodeMenu — SiYuan-style row context menu ──────────────────
   Shown on right-click and on the `…` overflow click. Mirrors SiYuan's
   layout so muscle memory transfers: Create above/below at the top,
   structural ops in the middle, destructive ops at the bottom. The Copy
   submenu opens to the right on hover (lookahead via setTimeout cancels
   the close if you slide into the submenu without bumping a sibling).

   Closes on outside click / Escape. We bump `pointerEvents=auto` after
   mount so the click that opened it doesn't immediately close it. */
function NodeMenu({
  doc, x, y, onClose,
  onCreateAbove, onCreateBelow, onCreateSub,
  onRename, onDuplicate, onMoveToRoot, onDelete,
}: {
  doc: Doc
  x: number; y: number; onClose: () => void
  onCreateAbove: () => void
  onCreateBelow: () => void
  onCreateSub:   () => void
  onRename:      () => void
  onDuplicate:   () => void
  onMoveToRoot?: () => void
  onDelete:      () => void
}) {
  const [copyOpen, setCopyOpen] = useState(false)
  const copyHoldRef = useRef<number | null>(null)

  useEffect(() => {
    const close = (e: Event) => {
      // Allow clicks INSIDE the menu (and the submenu) without closing.
      const t = e.target as HTMLElement | null
      if (t?.closest('[data-doctree-menu]')) return
      onClose()
    }
    document.addEventListener('mousedown', close)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Copy actions write to clipboard and show a brief toast via the global
  // event bus. We dispatch a CustomEvent that the root layout picks up — the
  // doc-view toast machinery handles the visual.
  function copy(label: string, text: string) {
    if (!text) return
    navigator.clipboard.writeText(text).then(() => {
      window.dispatchEvent(new CustomEvent('os:toast', { detail: `Copied ${label}` }))
    }).catch((e) => console.error('clipboard write failed', e))
    onClose()
  }

  return (
    <motion.div
      data-doctree-menu
      initial={{ opacity: 0, y: -4, scale: 0.97 }}
      animate={{ opacity: 1, y: 0,  scale: 1 }}
      transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
      onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
      className="fixed z-[100] w-56 py-1 shadow-xl"
      style={{
        left: x, top: y,
        background: 'var(--color-bg-strong)',
        border: '1px solid var(--color-border)',
        borderRadius: '0.5rem',
      }}
    >
      <Row icon={<Plus size={13} />}    label="Create doc above" onClick={onCreateAbove} />
      <Row icon={<Plus size={13} />}    label="Create doc below" onClick={onCreateBelow} />

      <Divider />

      {/* Copy — with submenu */}
      <div
        data-doctree-menu
        className="relative"
        onMouseEnter={() => {
          if (copyHoldRef.current) clearTimeout(copyHoldRef.current)
          setCopyOpen(true)
        }}
        onMouseLeave={() => {
          // Small grace period so the user can slide diagonally into the
          // submenu without it snapping shut.
          copyHoldRef.current = window.setTimeout(() => setCopyOpen(false), 120)
        }}
      >
        <Row
          icon={<Copy size={13} />}
          label="Copy"
          right={<ChevronRight size={11} />}
          onClick={() => setCopyOpen((v) => !v)}
        />
        {copyOpen && (
          <div
            data-doctree-menu
            className="absolute left-full top-0 ml-1 w-56 py-1 shadow-xl"
            style={{
              background: 'var(--color-bg-strong)',
              border: '1px solid var(--color-border)',
              borderRadius: '0.5rem',
            }}
          >
            <Row icon={<FileText size={13} />}     label="As Markdown link"
                 sub={`[${doc.title}](...)`}
                 onClick={() => copy('Markdown link', `[${doc.title}](openspider://doc/${doc.id})`)} />
            <Row icon={<Link2 size={13} />}        label="As wiki-link"
                 sub={`[[${doc.title}]]`}
                 onClick={() => copy('wiki-link', `[[${doc.title}]]`)} />
            <Row icon={<FileQuestion size={13} />} label="Doc ID"
                 sub={doc.id}
                 onClick={() => copy('doc ID', doc.id)} />
          </div>
        )}
      </div>

      <Row icon={<Copy size={13} />}        label="Duplicate"     onClick={onDuplicate} />
      <Row icon={<Plus size={13} />}        label="New sub-doc"   onClick={onCreateSub} />
      {onMoveToRoot && (
        <Row icon={<FolderInput size={13} />} label="Move to root" onClick={onMoveToRoot} />
      )}

      <Divider />

      <Row icon={<ArrowRight size={13} />}  label="Open in new tab"
           onClick={() => {
             store.open({ title: doc.title, icon: doc.icon, view: { kind: 'doc', docId: doc.id } })
             onClose()
           }} />

      <Divider />

      <Row icon={<Edit3 size={13} />}       label="Rename"  shortcut="F2"  onClick={onRename} />
      <Row icon={<Trash2 size={13} />}      label="Delete"  shortcut="⌘⌫" onClick={onDelete} danger />
    </motion.div>
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
      data-doctree-menu
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-[var(--color-border-soft)]"
      style={{ color: danger ? 'var(--color-danger)' : 'var(--color-text)' }}
    >
      <span style={{ color: danger ? 'var(--color-danger)' : 'var(--color-text-subtle)', flexShrink: 0 }}>{icon}</span>
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

/* ────────── helpers ────────── */

function cmpDocs(a: Doc, b: Doc): number {
  // Sibling order = position-asc, undefined-last, ties broken alphabetically.
  // Mirrors `cmp_position_then_title` in vault.rs so optimistic UI matches
  // server truth on the next refetch.
  const ap = a.position ?? Number.POSITIVE_INFINITY
  const bp = b.position ?? Number.POSITIVE_INFINITY
  if (ap !== bp) return ap - bp
  return a.title.localeCompare(b.title)
}

function buildTree(flat: Doc[]): Node[] {
  const byId = new Map<string, Node>()
  for (const d of flat) byId.set(d.id, { ...d, children: [] })
  const roots: Node[] = []
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  const sortRec = (xs: Node[]) => {
    xs.sort(cmpDocs)
    for (const x of xs) sortRec(x.children)
  }
  sortRec(roots)
  return roots
}

/** Compute the new ordered sibling list after inserting `insertId` next to
 *  `relativeToId` on the given side. Used by both drag-drop and "Create
 *  doc above/below" so the visual order is computed in one place. */
function orderedSiblingsAfterInsert(
  allDocs: Doc[],
  parentId: string | null,
  relativeToId: string,
  insertId: string,
  side: 'above' | 'below',
): Doc[] {
  const siblings = allDocs
    .filter((d) => (d.parentId ?? null) === parentId && d.id !== insertId)
    .sort(cmpDocs)
  const inserted = allDocs.find((d) => d.id === insertId)
  if (!inserted) return siblings
  const idx = siblings.findIndex((d) => d.id === relativeToId)
  if (idx < 0) return [...siblings, inserted]
  const insertAt = side === 'above' ? idx : idx + 1
  return [...siblings.slice(0, insertAt), inserted, ...siblings.slice(insertAt)]
}

/** Map node.id → set of all its descendant node ids. Used by drag-drop to
 *  reject moves that would create a cycle (drop into self / own subtree). */
function indexDescendants(tree: Node[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  function walk(node: Node): Set<string> {
    const set = new Set<string>()
    for (const child of node.children) {
      set.add(child.id)
      for (const grand of walk(child)) set.add(grand)
    }
    out.set(node.id, set)
    return set
  }
  for (const root of tree) walk(root)
  return out
}

function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw))
  } catch { return new Set() }
}
function saveExpanded(s: Set<string>) {
  try { localStorage.setItem(EXPANDED_KEY, JSON.stringify(Array.from(s))) } catch { /* */ }
}

/* ────────── Drop indicator line ─────────────────────────────────────
   Thin accent-coloured line that sits between rows when the drop position
   is `above` or `below`. The leading dot is just for visual punctuation —
   makes the line read as an INSERTION POINT, not a divider. */
function DropLine({ indent }: { indent: number }) {
  return (
    <div
      style={{
        position: 'relative',
        height: 0,
        marginLeft: indent + 18,
        marginRight: 6,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0, right: 0,
          top: -1,
          height: 2,
          background: 'var(--color-accent)',
          borderRadius: 1,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: -3,
          top: -4,
          width: 8, height: 8,
          borderRadius: 999,
          background: 'var(--color-accent)',
          boxShadow: '0 0 0 2px var(--color-bg-soft)',
        }}
      />
    </div>
  )
}

/* ────────── Custom drag preview ─────────────────────────────────────
   Replaces the browser's bulky default ghost (which makes drags look like
   "I'm uploading a file from Finder"). We render a slim pill once,
   `setDragImage()` it, then remove on the next tick — the pill only
   exists for the snapshot that the OS captures. */
function makeDragPill(title: string, icon?: string): HTMLDivElement {
  const el = document.createElement('div')
  // Off-screen so the user never sees the live element — only the captured
  // image follows the cursor.
  el.style.cssText = `
    position: fixed; top: -9999px; left: -9999px;
    display: inline-flex; align-items: center; gap: 8px;
    padding: 6px 12px;
    background: #1c1917;
    color: #fff;
    border-radius: 6px;
    font: 500 13px/1 Inter, system-ui, sans-serif;
    box-shadow: 0 8px 24px -6px rgba(0,0,0,0.4);
    pointer-events: none;
    white-space: nowrap;
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
  `
  el.textContent = `${icon ?? '📄'}  ${title}`
  return el
}
