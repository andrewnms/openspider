import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Plus, Play, Cpu } from '../lib/icons'
import { k, type Agent, type Run, type Trigger } from '../lib/mcp'
import { store } from '../store'
import { appPrompt } from '../lib/dialog'

export function AgentsListView() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [refresh, setRefresh] = useState(0)
  useEffect(() => { k.listAgents().then(setAgents) }, [refresh])

  return (
    <div className="h-full overflow-auto px-8 py-10" style={{ background: 'var(--color-bg-strong)' }}>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center mb-8">
          <div className="w-10 h-10 grid place-items-center rounded-lg mr-3"
               style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}>
            <Cpu size={20} />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold leading-tight">Agents</h1>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Sandboxed JS scripts that run on triggers or on demand.
            </p>
          </div>
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            transition={{ duration: 0.08 }}
            onClick={async () => {
              const name = await appPrompt('Agent name?'); if (!name) return
              const created = await k.createAgent({ name, model: 'x-ai/grok-4-fast', compiledScript: 's16.log("hello!"); return { ok: true };' })
              setRefresh((n) => n + 1)
              store.open({ title: created.name, icon: '🤖', view: { kind: 'agent', agentId: created.id } })
            }}
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md font-medium text-white"
            style={{ background: 'var(--color-accent)' }}
          ><Plus size={14} /> New agent</motion.button>
        </div>

        {/* Tile grid — 1 / 2 / 3 columns scaling with width. Tiles are
           uniform-height, hover-lifts, and lead with a robot pip so the
           list reads as objects, not rows. */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((a) => (
            <motion.button
              key={a.id}
              onClick={() => store.open({ title: a.name, icon: '🤖', view: { kind: 'agent', agentId: a.id } })}
              whileHover={{ y: -2 }}
              transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
              className="text-left rounded-xl p-4 flex flex-col gap-2"
              style={{
                background: 'var(--color-bg-soft)',
                border: '1px solid var(--color-border)',
                minHeight: 130,
              }}
            >
              <div className="flex items-start gap-2.5">
                <div className="w-9 h-9 grid place-items-center rounded-lg shrink-0 text-base"
                     style={{ background: 'var(--color-bg-strong)', border: '1px solid var(--color-border-soft)' }}>
                  🤖
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{a.name}</div>
                  <div className="text-[11px] mono mt-0.5 truncate" style={{ color: 'var(--color-text-subtle)' }}>
                    {a.model || 'no model set'}
                  </div>
                </div>
              </div>
              {a.description ? (
                <div className="text-xs line-clamp-3 leading-snug" style={{ color: 'var(--color-text-muted)' }}>
                  {a.description}
                </div>
              ) : (
                <div className="text-xs italic" style={{ color: 'var(--color-text-subtle)' }}>
                  No description.
                </div>
              )}
            </motion.button>
          ))}
          {agents.length === 0 && (
            <div className="col-span-full rounded-xl p-8 text-center"
                 style={{ background: 'var(--color-bg-soft)', border: '1px dashed var(--color-border)' }}>
              <div className="text-3xl mb-2">🤖</div>
              <div className="text-sm font-medium mb-1">No agents yet.</div>
              <div className="text-xs" style={{ color: 'var(--color-text-subtle)' }}>
                Hit "New agent" to scaffold one. They run as sandboxed JS — fast, cheap, deterministic.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function AgentView({ agentId }: { agentId: string }) {
  const [agent, setAgent] = useState<Agent | null>(null)
  const [script, setScript] = useState('')
  const [triggers] = useState<Trigger[]>([])
  const [recentRuns, setRecentRuns] = useState<Run[]>([])
  const [running, setRunning] = useState(false)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    k.getAgent(agentId).then((a) => { setAgent(a); setScript(a.compiledScript ?? '') })
    k.listRuns(agentId, 5).then(setRecentRuns).catch(() => setRecentRuns([]))
  }, [agentId, refresh])

  if (!agent) return <div className="p-8" style={{ color: 'var(--color-text-subtle)' }}>Loading…</div>

  return (
    <div className="h-full grid grid-cols-[1fr_320px]" style={{ background: 'var(--color-bg-strong)' }}>
      <div className="overflow-auto px-8 py-8">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-baseline gap-3 mb-2">
            <span className="text-3xl">🤖</span>
            <input
              defaultValue={agent.name}
              onBlur={(e) => k.updateAgent(agent.id, { name: e.target.value })}
              className="flex-1 text-3xl font-bold bg-transparent border-none outline-none"
            />
            <button
              onClick={async () => { setRunning(true); try { await k.runAgent(agent.id); setRefresh(n => n+1) } finally { setRunning(false) } }}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--color-accent)' }}
              disabled={running}
            ><Play size={14} /> {running ? 'Running…' : 'Run now'}</button>
          </div>
          <input
            defaultValue={agent.description ?? ''}
            onBlur={(e) => k.updateAgent(agent.id, { description: e.target.value })}
            placeholder="Description"
            className="w-full bg-transparent border-none outline-none text-sm mb-2"
            style={{ color: 'var(--color-text-muted)' }}
          />

          <div className="grid grid-cols-2 gap-3 my-4">
            <div>
              <div className="text-xs mb-1" style={{ color: 'var(--color-text-subtle)' }}>Model</div>
              <input
                defaultValue={agent.model ?? ''}
                onBlur={(e) => k.updateAgent(agent.id, { model: e.target.value })}
                className="w-full bg-[var(--color-bg-soft)] border rounded px-2 py-1 text-sm mono"
                style={{ borderColor: 'var(--color-border)' }}
              />
            </div>
          </div>

          <div className="text-[11px] uppercase tracking-wider font-semibold mb-1"
               style={{ color: 'var(--color-text-subtle)' }}>compiledScript</div>
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            onBlur={() => k.updateAgent(agent.id, { compiledScript: script })}
            className="w-full font-mono text-xs bg-[var(--color-bg-soft)] border rounded p-3"
            style={{ borderColor: 'var(--color-border)', minHeight: '40vh' }}
          />
        </div>
      </div>

      {/* right side: triggers + recent runs */}
      <aside className="overflow-auto p-6"
             style={{ background: 'var(--color-bg-soft)', borderLeft: '1px solid var(--color-border)' }}>
        <div className="text-[11px] uppercase tracking-wider font-semibold mb-3"
             style={{ color: 'var(--color-text-subtle)' }}>Triggers</div>
        <button
          onClick={async () => {
            const type = await appPrompt('Trigger type? (cron, webhook, event, gmail, agent_change)', 'cron')
            if (!type) return
            const cfgRaw = await appPrompt('Config JSON?', type === 'cron' ? '{"schedule":"0 */15 * * * *"}' : '{}')
            if (!cfgRaw) return
            await k.setTrigger(agent.id, type, JSON.parse(cfgRaw))
            setRefresh((n) => n + 1)
          }}
          className="text-xs flex items-center gap-1 mb-4"
          style={{ color: 'var(--color-accent)' }}
        ><Plus size={12} /> Add trigger</button>

        <div className="text-[11px] uppercase tracking-wider font-semibold mt-4 mb-2"
             style={{ color: 'var(--color-text-subtle)' }}>Recent runs</div>
        <div className="space-y-2">
          {recentRuns.map((r) => (
            <div key={r.id} className="text-xs rounded-md p-2"
                 style={{ background: 'var(--color-bg-strong)', border: '1px solid var(--color-border)' }}>
              <div className="flex items-center gap-2">
                <span className="mono" style={{ color: r.status === 'success' ? 'var(--color-success)' : r.status === 'failed' ? 'var(--color-danger)' : 'var(--color-text-subtle)' }}>
                  {r.status}
                </span>
                <span style={{ color: 'var(--color-text-subtle)' }}>{r.startedAt.split('T')[1]?.split('.')[0]}</span>
              </div>
              {r.scriptLogs && r.scriptLogs.length > 0 && (
                <div className="mt-1 mono" style={{ color: 'var(--color-text-muted)' }}>
                  {r.scriptLogs.slice(0, 3).map((l, i) => <div key={i} className="truncate">· {l}</div>)}
                </div>
              )}
            </div>
          ))}
          {recentRuns.length === 0 && <div className="text-xs" style={{ color: 'var(--color-text-subtle)' }}>No runs yet.</div>}
        </div>

        {triggers.length > 0 && <pre className="text-[10px] mt-4">{JSON.stringify(triggers, null, 2)}</pre>}
      </aside>
    </div>
  )
}
