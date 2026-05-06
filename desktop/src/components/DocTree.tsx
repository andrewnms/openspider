/**
 * Hierarchical doc tree for the sidebar.
 *
 * Builds the tree client-side from the flat list returned by `k.listAllDocs()`
 * — cheap (typically < 1000 docs) and avoids per-node fetches. Each node
 * supports expand/collapse, click-to-open, hover `+` for new sub-doc,
 * right-click context menu (Rename / New sub-doc / Move to root / Delete),
 * and **drag-and-drop reparenting** — drag a doc onto another to make it a
 * sub-doc; drop on the empty root area to detach to top-level.
 *
 * Persisted UI state: which parent IDs are expanded. Lives in localStorage
 * under `os.docTree.expanded` so the tree feels like it remembers you.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { ChevronRight, FileText, Plus, MoreHorizontal, Trash2, Edit3, FolderInput } from '../lib/icons'
import { k, type Doc } from '../lib/mcp'
import { store } from '../store'
import { appPrompt, appConfirm } from '../lib/dialog'

const EXPANDED_KEY = 'os.docTree.expanded'
const DRAG_MIME    = 'application/x-openspider-doc'

type Node = Doc & { children: Node[] }

export function DocTree({ activeTabId, refreshTick }: {
  activeTabId: string | null
  refreshTick: number
}) {
  const [docs, setDocs] = useState<Doc[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpanded())
  // Active drag — null when nothing's being dragged. We mirror this in a ref
  // so DOM event handlers see the latest value without stale closures.
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | 'root' | null>(null)
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

  async function rename(doc: Doc) {
    const title = await appPrompt('New title?', doc.title)
    if (!title || title === doc.title) return
    const updated = await k.updateDoc(doc.id, { title })
    setDocs((xs) => xs.map((d) => d.id === doc.id ? { ...d, ...updated } : d))
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

  /** Move `draggedId` under `targetId` (or to root if `targetId` is null). */
  async function performMove(targetId: string | null) {
    const id = draggedIdRef.current
    if (!id) return
    // Cycle prevention: target can't be the dragged node itself or any of
    // its descendants — that would create an infinite loop in the tree.
    if (id === targetId) return
    if (targetId && descendantsOf.get(id)?.has(targetId)) return
    // Optimistic UI — flip the parent locally, then call the server.
    setDocs((xs) => xs.map((d) => d.id === id ? { ...d, parentId: targetId } : d))
    if (targetId) {
      setExpanded((prev) => {
        const next = new Set(prev); next.add(targetId); saveExpanded(next); return next
      })
    }
    try { await k.moveDoc(id, targetId) }
    catch (e) { console.error('move failed', e) /* could re-fetch to recover */ }
  }

  function isValidTarget(targetId: string): boolean {
    const id = draggedIdRef.current
    if (!id || id === targetId) return false
    return !descendantsOf.get(id)?.has(targetId)
  }

  function onRootDragOver(e: React.DragEvent) {
    if (!draggedIdRef.current) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTarget('root')
  }
  async function onRootDrop(e: React.DragEvent) {
    e.preventDefault()
    setDropTarget(null)
    const id = e.dataTransfer.getData(DRAG_MIME) || draggedIdRef.current
    if (!id) return
    await performMove(null)
    setDraggedId(null)
  }

  return (
    <div onDragLeave={() => setDropTarget(null)}>
      {tree.map((n) => (
        <NodeRow
          key={n.id}
          node={n}
          depth={0}
          activeTabId={activeTabId}
          expanded={expanded}
          draggedId={draggedId}
          dropTarget={dropTarget}
          onToggle={toggle}
          onCreateSub={createSub}
          onRename={rename}
          onMoveToRoot={moveToRoot}
          onDelete={remove}
          onDragStart={(id) => setDraggedId(id)}
          onDragEnd={() => { setDraggedId(null); setDropTarget(null) }}
          onSetDropTarget={setDropTarget}
          onValidateTarget={isValidTarget}
          onPerformMove={performMove}
        />
      ))}

      {/* Root drop zone — drag here to detach a doc to top-level.
         Doubles as the "New doc" affordance when nothing's being dragged. */}
      <div
        onDragOver={onRootDragOver}
        onDrop={onRootDrop}
        style={{
          background: dropTarget === 'root' ? 'var(--color-accent-soft)' : 'transparent',
          outline:    dropTarget === 'root' ? '1px dashed var(--color-accent)' : 'none',
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
  node, depth, activeTabId, expanded, draggedId, dropTarget,
  onToggle, onCreateSub, onRename, onMoveToRoot, onDelete,
  onDragStart, onDragEnd, onSetDropTarget, onValidateTarget, onPerformMove,
}: {
  node: Node
  depth: number
  activeTabId: string | null
  expanded: Set<string>
  draggedId: string | null
  dropTarget: string | 'root' | null
  onToggle:        (id: string) => void
  onCreateSub:     (parent: Doc) => void
  onRename:        (doc: Doc) => void
  onMoveToRoot:    (doc: Doc) => void
  onDelete:        (doc: Doc) => void
  onDragStart:     (id: string) => void
  onDragEnd:       () => void
  onSetDropTarget: (id: string | 'root' | null) => void
  onValidateTarget:(id: string) => boolean
  onPerformMove:   (targetId: string) => Promise<void>
}) {
  const [hover, setHover] = useState(false)
  const [menu, setMenu]   = useState<{ x: number; y: number } | null>(null)

  const id = JSON.stringify({ kind: 'doc', docId: node.id })
  const active = activeTabId === id
  const isOpen = expanded.has(node.id)
  const hasChildren = node.children.length > 0
  const indent = 6 + depth * 18

  const isDragging = draggedId === node.id
  const isDropTarget = dropTarget === node.id

  function onDragStartRow(e: React.DragEvent) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(DRAG_MIME, node.id)
    onDragStart(node.id)
  }
  function onDragOverRow(e: React.DragEvent) {
    if (!draggedId || !onValidateTarget(node.id)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    onSetDropTarget(node.id)
  }
  async function onDropRow(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    onSetDropTarget(null)
    if (!draggedId || !onValidateTarget(node.id)) {
      onDragEnd()
      return
    }
    await onPerformMove(node.id)
    onDragEnd()
  }

  return (
    <div>
      <div
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
            isDropTarget ? 'var(--color-accent-soft)' :
            active       ? 'var(--color-accent-soft)' :
            'transparent',
          outline: isDropTarget ? '1px dashed var(--color-accent)' : 'none',
          opacity: isDragging ? 0.4 : 1,
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
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
            onRename={() => { onRename(node); setMenu(null) }}
            onCreateSub={() => { onCreateSub(node); setMenu(null) }}
            onMoveToRoot={node.parentId ? () => { onMoveToRoot(node); setMenu(null) } : undefined}
            onDelete={() => { onDelete(node); setMenu(null) }}
          />
        )}
      </div>

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
                dropTarget={dropTarget}
                onToggle={onToggle}
                onCreateSub={onCreateSub}
                onRename={onRename}
                onMoveToRoot={onMoveToRoot}
                onDelete={onDelete}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onSetDropTarget={onSetDropTarget}
                onValidateTarget={onValidateTarget}
                onPerformMove={onPerformMove}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function NodeMenu({
  x, y, onClose, onRename, onCreateSub, onMoveToRoot, onDelete,
}: {
  x: number; y: number; onClose: () => void
  onRename: () => void; onCreateSub: () => void
  onMoveToRoot?: () => void; onDelete: () => void
}) {
  useEffect(() => {
    const close = () => onClose()
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [onClose])

  return (
    <motion.div
      initial={{ opacity: 0, y: -4, scale: 0.97 }}
      animate={{ opacity: 1, y: 0,  scale: 1 }}
      transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
      onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
      className="fixed z-[100] w-48 py-1 shadow-xl"
      style={{
        left: x, top: y,
        background: 'var(--color-bg-strong)',
        border: '1px solid var(--color-border)',
        borderRadius: '0.5rem',
      }}
    >
      <Row icon={<Edit3 size={13} />}        label="Rename"      onClick={onRename} />
      <Row icon={<Plus size={13} />}         label="New sub-doc" onClick={onCreateSub} />
      {onMoveToRoot && (
        <Row icon={<FolderInput size={13} />} label="Move to root" onClick={onMoveToRoot} />
      )}
      <div className="my-1" style={{ borderTop: '1px solid var(--color-border-soft)' }} />
      <Row icon={<Trash2 size={13} />}       label="Delete"      onClick={onDelete} danger />
    </motion.div>
  )
}

function Row({
  icon, label, onClick, danger,
}: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-[var(--color-border-soft)]"
      style={{ color: danger ? 'var(--color-danger)' : 'var(--color-text)' }}
    >
      <span style={{ color: danger ? 'var(--color-danger)' : 'var(--color-text-subtle)' }}>{icon}</span>
      {label}
    </button>
  )
}

/* ────────── helpers ────────── */

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
    xs.sort((a, b) => a.title.localeCompare(b.title))
    for (const x of xs) sortRec(x.children)
  }
  sortRec(roots)
  return roots
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
