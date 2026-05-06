/**
 * Workspace graph: docs as nodes, "soft" wiki-link references as edges.
 *
 * Layout: d3-force simulation (charge + link + center + collision). Render:
 * SVG so we get crisp lines + free zoom-fit + theme-aware colors via CSS
 * variables. Pan/zoom is hand-rolled so we don't pull in d3-zoom.
 *
 * Edge inference: for each doc D, search the workspace for D.title. Any
 * other-doc hit becomes an edge target → source. This is intentionally
 * loose — when the proper `((blockId))` reference index lands we swap
 * this for an exact lookup.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import {
  forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide,
  type Simulation, type SimulationNodeDatum, type SimulationLinkDatum,
} from 'd3-force'
import { Network, RefreshCw } from '../lib/icons'
import { k, type Doc } from '../lib/mcp'
import { store } from '../store'

type Node = SimulationNodeDatum & { id: string; title: string; refCount: number }
type Link = SimulationLinkDatum<Node>

const WIDTH  = 1400
const HEIGHT = 900

export function GraphView() {
  const [docs, setDocs]   = useState<Doc[] | null>(null)
  const [edges, setEdges] = useState<Array<{ source: string; target: string }>>([])
  const [loading, setLoading] = useState(true)
  const [refreshTick, setRefresh] = useState(0)

  // Pan/zoom state — translate (tx,ty) and scale.
  const [view, setView] = useState({ tx: 0, ty: 0, scale: 1 })
  const dragRef = useRef<{ startX: number; startY: number; tx0: number; ty0: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // Hovered node id (for link emphasis)
  const [hover, setHover] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const all = await k.listAllDocs().catch(() => [] as Doc[])
      if (cancelled) return
      setDocs(all)

      // Build edges by searching for each doc's title. Throttle to 8 in flight
      // so we don't hammer the kernel on big vaults.
      const titleToId = new Map<string, string>()
      for (const d of all) titleToId.set(d.title.toLowerCase(), d.id)

      const newEdges: Array<{ source: string; target: string }> = []
      const seen = new Set<string>()
      const queue = [...all]
      const inflight = new Set<Promise<void>>()
      const POOL = 8

      async function workOne(doc: Doc) {
        try {
          const r = await k.search(doc.title, 20)
          for (const h of r.items as Array<Record<string, unknown>>) {
            if (h.kind !== 'doc') continue
            const sourceId = String(h.id ?? '')
            if (!sourceId || sourceId === doc.id) continue
            const key = `${sourceId}>${doc.id}`
            if (seen.has(key)) continue
            seen.add(key)
            newEdges.push({ source: sourceId, target: doc.id })
          }
        } catch { /* skip */ }
      }

      while (queue.length > 0 || inflight.size > 0) {
        if (cancelled) return
        while (inflight.size < POOL && queue.length > 0) {
          const next = queue.shift()!
          const p = workOne(next).finally(() => { inflight.delete(p) })
          inflight.add(p)
        }
        await Promise.race(inflight)
      }
      if (cancelled) return

      setEdges(newEdges)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [refreshTick])

  // Build nodes with reference counts (incoming edges).
  const { nodes, links } = useMemo(() => {
    if (!docs) return { nodes: [] as Node[], links: [] as Link[] }
    const byId = new Map<string, Node>()
    for (const d of docs) {
      byId.set(d.id, { id: d.id, title: d.title, refCount: 0 })
    }
    for (const e of edges) {
      const t = byId.get(e.target); if (t) t.refCount++
    }
    const nodes = Array.from(byId.values())
    const links: Link[] = edges
      .filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => ({ source: e.source, target: e.target }))
    return { nodes, links }
  }, [docs, edges])

  // Simulation. We re-create it whenever node/link sets change.
  const simRef = useRef<Simulation<Node, Link> | null>(null)
  const [, tick] = useState(0)
  useEffect(() => {
    if (nodes.length === 0) return
    simRef.current?.stop()
    const sim = forceSimulation<Node, Link>(nodes)
      .force('link',   forceLink<Node, Link>(links).id((d) => d.id).distance(80).strength(0.35))
      .force('charge', forceManyBody().strength(-160))
      .force('center', forceCenter(WIDTH / 2, HEIGHT / 2))
      .force('collide', forceCollide<Node>().radius((n) => 8 + Math.min(20, n.refCount * 2)).iterations(2))
      .alpha(1).alphaDecay(0.04).velocityDecay(0.4)
    sim.on('tick', () => tick((n) => n + 1))
    simRef.current = sim
    return () => { sim.stop() }
  }, [nodes, links])

  // Pan with drag, zoom with wheel.
  function onMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, tx0: view.tx, ty0: view.ty }
  }
  useEffect(() => {
    function move(e: MouseEvent) {
      const d = dragRef.current; if (!d) return
      setView((v) => ({ ...v, tx: d.tx0 + (e.clientX - d.startX), ty: d.ty0 + (e.clientY - d.startY) }))
    }
    function up() { dragRef.current = null }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup',   up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup',   up)
    }
  }, [])
  function onWheel(e: React.WheelEvent) {
    e.preventDefault()
    const delta = -e.deltaY * 0.001
    setView((v) => {
      const nextScale = Math.max(0.2, Math.min(4, v.scale * (1 + delta)))
      return { ...v, scale: nextScale }
    })
  }

  // Highlighted edges connected to the hovered node.
  const hoverNeighbors = useMemo(() => {
    if (!hover) return new Set<string>()
    const s = new Set<string>()
    for (const e of edges) {
      if (e.source === hover) s.add(e.target)
      if (e.target === hover) s.add(e.source)
    }
    return s
  }, [edges, hover])

  return (
    <div className="h-full w-full relative overflow-hidden"
         style={{ background: 'var(--color-bg-strong)' }}>
      {/* HUD */}
      <header className="absolute top-3 left-3 z-10 flex items-center gap-2">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md backdrop-blur-sm"
             style={{ background: 'color-mix(in oklab, var(--color-bg-strong) 75%, transparent)',
                      border: '1px solid var(--color-border)' }}>
          <Network size={13} style={{ color: 'var(--color-accent)' }} />
          <span className="text-[11px] uppercase tracking-wider font-semibold"
                style={{ color: 'var(--color-text-muted)' }}>Global Graph</span>
          {docs && (
            <span className="text-[10px] mono" style={{ color: 'var(--color-text-subtle)' }}>
              · {nodes.length} docs · {links.length} links
            </span>
          )}
        </div>
        <motion.button
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.92 }}
          onClick={() => setRefresh((n) => n + 1)}
          title="Recompute layout"
          className="w-8 h-8 grid place-items-center rounded-md backdrop-blur-sm"
          style={{ background: 'color-mix(in oklab, var(--color-bg-strong) 75%, transparent)',
                   border: '1px solid var(--color-border)',
                   color: 'var(--color-text-muted)' }}
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </motion.button>
      </header>

      {/* Canvas */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-full cursor-grab active:cursor-grabbing"
        onMouseDown={onMouseDown}
        onWheel={onWheel}
        style={{ touchAction: 'none' }}
      >
        <g transform={`translate(${view.tx}, ${view.ty}) scale(${view.scale})`}>
          {/* Edges */}
          {links.map((l, i) => {
            const s = l.source as Node
            const t = l.target as Node
            const dim = !!hover && !hoverNeighbors.has(s.id) && !hoverNeighbors.has(t.id) && s.id !== hover && t.id !== hover
            return (
              <line
                key={i}
                x1={s.x ?? 0} y1={s.y ?? 0}
                x2={t.x ?? 0} y2={t.y ?? 0}
                stroke="var(--color-accent)"
                strokeWidth={1}
                strokeOpacity={dim ? 0.08 : 0.45}
              />
            )
          })}
          {/* Nodes */}
          {nodes.map((n) => {
            const isHover = n.id === hover
            const isNeighbor = hoverNeighbors.has(n.id)
            const dim = !!hover && !isHover && !isNeighbor
            const r = 4 + Math.min(14, n.refCount * 1.5)
            return (
              <g
                key={n.id}
                transform={`translate(${n.x ?? 0}, ${n.y ?? 0})`}
                style={{ cursor: 'pointer', opacity: dim ? 0.25 : 1, transition: 'opacity 120ms ease' }}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => store.open({ title: n.title, view: { kind: 'doc', docId: n.id } })}
              >
                <circle
                  r={r}
                  fill={isHover ? 'var(--color-accent)' : 'var(--color-text-muted)'}
                  stroke="var(--color-bg-strong)"
                  strokeWidth={2}
                />
                {(isHover || n.refCount > 2) && (
                  <text
                    y={r + 12}
                    textAnchor="middle"
                    fontSize={11}
                    fill="var(--color-text)"
                    fontWeight={isHover ? 600 : 400}
                    style={{ pointerEvents: 'none' }}
                  >
                    {n.title}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>

      {/* Empty state */}
      {!loading && nodes.length === 0 && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="text-sm" style={{ color: 'var(--color-text-subtle)' }}>
            No docs yet. Create one to start building your graph.
          </div>
        </div>
      )}

      {/* Hint */}
      <div className="absolute bottom-3 right-3 text-[10px] mono px-2 py-1 rounded backdrop-blur-sm"
           style={{ background: 'color-mix(in oklab, var(--color-bg-strong) 75%, transparent)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text-subtle)' }}>
        drag to pan · scroll to zoom · click a node to open
      </div>
    </div>
  )
}
