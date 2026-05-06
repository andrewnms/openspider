import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Plus, Play, Cpu, Sparkles, ChevronRight } from '../lib/icons'
import { k, type Agent, type Run, type Trigger } from '../lib/mcp'
import { store } from '../store'
import { appPrompt, appAlert } from '../lib/dialog'
import { isAIConfigured } from '../lib/ai'
import { AgentPlannerChatHost } from '../components/AgentPlannerChat'

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
            onClick={() => {
              // Route through the chat planner — design + name + create in
              // one flow. The global GlobalAgentPlanner host opens the new
              // agent's tab automatically on apply.
              window.dispatchEvent(new CustomEvent('os:open-agent-planner', { detail: null }))
              // Refresh the list when the planner closes (covers both
              // applied and cancelled cases).
              const refreshOnce = () => { setRefresh((n) => n + 1); window.removeEventListener('focus', refreshOnce) }
              window.addEventListener('focus', refreshOnce)
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

type Mode = 'prompt' | 'script' | 'hybrid'

/** Infer the working mode from which fields are populated. New agents
 *  default to 'prompt' since that's the most common Notion-style use-case
 *  (system-prompt + LLM, no codegen). The user can flip modes any time. */
function inferMode(agent: Agent): Mode {
  const hasScript = !!(agent.compiledScript && agent.compiledScript.trim())
  const hasPrompt = !!(agent.systemPrompt   && agent.systemPrompt.trim())
  if (hasScript && hasPrompt) return 'hybrid'
  if (hasScript)              return 'script'
  return 'prompt'
}

export function AgentView({ agentId }: { agentId: string }) {
  const [agent, setAgent] = useState<Agent | null>(null)
  const [mode,  setMode]  = useState<Mode>('prompt')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [script, setScript]             = useState('')
  const [recentRuns, setRecentRuns]     = useState<Run[]>([])
  const [triggers]                      = useState<Trigger[]>([])
  const [running,  setRunning]          = useState(false)
  const [plannerOpen, setPlannerOpen]   = useState(false)
  const [refresh,  setRefresh]          = useState(0)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  useEffect(() => {
    k.getAgent(agentId).then((a) => {
      setAgent(a)
      setMode(inferMode(a))
      setSystemPrompt(a.systemPrompt ?? '')
      setScript(a.compiledScript ?? '')
    })
    k.listRuns(agentId, 5).then(setRecentRuns).catch(() => setRecentRuns([]))
  }, [agentId, refresh])

  if (!agent) return <div className="p-8" style={{ color: 'var(--color-text-subtle)' }}>Loading…</div>

  async function runNow() {
    setRunning(true)
    try { await k.runAgent(agent!.id); setRefresh((n) => n + 1) }
    finally { setRunning(false) }
  }

  /** Open the chat planner. The chat handles its own AI calls, mention
   *  picker, and apply-plan affordance — when it commits a plan, it calls
   *  back through onApplied with the patched agent + chosen mode. */
  function openPlanner() {
    if (!isAIConfigured()) {
      appAlert('Configure your AI endpoint + model in Settings → AI first.')
      return
    }
    setPlannerOpen(true)
  }

  /** Switch mode without losing what the user already wrote — empty fields
   *  for the *new* mode get cleared on save, but anything they typed stays
   *  in local state until they explicitly clear or re-plan. */
  async function saveMode(next: Mode) {
    setMode(next)
    const patch: Partial<Agent> = {}
    if (next === 'prompt') patch.compiledScript = ''
    if (next === 'script') patch.systemPrompt   = ''
    // hybrid keeps both; nothing to clear
    if (Object.keys(patch).length > 0) {
      const updated = await k.updateAgent(agent!.id, patch)
      setAgent(updated)
      if (patch.compiledScript === '') setScript('')
      if (patch.systemPrompt === '')   setSystemPrompt('')
    }
  }

  return (
    <div className="h-full grid grid-cols-[1fr_320px]" style={{ background: 'var(--color-bg-strong)' }}>
      <div className="overflow-auto px-10 py-10">
        <div className="max-w-3xl mx-auto">
          {/* ── Header — icon · name · run · plan ── */}
          <div className="flex items-center gap-3 mb-3">
            <span className="text-3xl">🤖</span>
            <input
              defaultValue={agent.name}
              onBlur={(e) => k.updateAgent(agent.id, { name: e.target.value })}
              className="flex-1 text-3xl font-bold bg-transparent border-none outline-none"
              placeholder="Untitled agent"
            />
            <motion.button
              whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              transition={{ duration: 0.08 }}
              onClick={openPlanner}
              className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md font-medium"
              style={{
                background: 'var(--color-bg-soft)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
              }}
            >
              <Sparkles size={14} /> Plan with AI
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              transition={{ duration: 0.08 }}
              onClick={runNow}
              disabled={running}
              className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--color-accent)' }}
            >
              <Play size={14} /> {running ? 'Running…' : 'Run now'}
            </motion.button>
          </div>

          {/* ── Description (multi-line — this drives Plan with AI) ── */}
          <textarea
            defaultValue={agent.description ?? ''}
            onBlur={(e) => k.updateAgent(agent.id, { description: e.target.value })}
            placeholder="What does this agent do?  (e.g. 'every morning, summarise the day's daily-note and email me the open questions')"
            className="w-full bg-transparent border-none outline-none text-base resize-none mb-8"
            style={{ color: 'var(--color-text-muted)', minHeight: 60 }}
          />

          {/* ── Mode picker ── */}
          <SectionLabel>Mode</SectionLabel>
          <div className="grid grid-cols-3 gap-2 mb-8">
            <ModeCard
              active={mode === 'prompt'}
              icon="💬" title="Prompt only"
              hint="System prompt + your LLM. Best for chat-style tasks: summarise, draft, classify."
              onClick={() => saveMode('prompt')}
            />
            <ModeCard
              active={mode === 'hybrid'}
              icon="🧬" title="Script + LLM"
              hint="JS orchestrates LLM calls. Best when you need conditional logic AND reasoning."
              onClick={() => saveMode('hybrid')}
            />
            <ModeCard
              active={mode === 'script'}
              icon="⚙️" title="Script only"
              hint="Pure JS, no LLM. Best for deterministic ops: cron jobs, ETLs, data shuffling."
              onClick={() => saveMode('script')}
            />
          </div>

          {/* ── System prompt (prompt + hybrid modes) ── */}
          {mode !== 'script' && (
            <>
              <SectionLabel>System prompt</SectionLabel>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                onBlur={() => k.updateAgent(agent.id, { systemPrompt })}
                placeholder={mode === 'prompt'
                  ? 'You are a helpful assistant that…'
                  : 'Optional context for s16.ai() calls inside the script.'}
                className="w-full text-sm rounded-lg p-3 outline-none mb-6"
                style={{
                  background: 'var(--color-bg-soft)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                  minHeight: mode === 'prompt' ? 200 : 110,
                  resize: 'vertical',
                }}
              />
            </>
          )}

          {/* ── Compiled script (script + hybrid modes) ── */}
          {mode !== 'prompt' && (
            <>
              <SectionLabel>Compiled script</SectionLabel>
              <textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                onBlur={() => k.updateAgent(agent.id, { compiledScript: script })}
                placeholder={'// Use s16.* helpers; return any JSON-serialisable value.\n' +
                  'const docs = await s16.docs.list()\n' +
                  's16.log(`Found ${docs.length} docs`)\n' +
                  'return { count: docs.length }'}
                className="w-full mono text-xs rounded-lg p-3 outline-none mb-6"
                style={{
                  background: 'var(--color-bg-soft)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                  minHeight: 240, resize: 'vertical',
                }}
              />
            </>
          )}

          {/* ── Advanced (collapsed: model, tools, skills) ── */}
          <button
            onClick={() => setAdvancedOpen((v) => !v)}
            className="text-xs flex items-center gap-1 mb-2"
            style={{ color: 'var(--color-text-subtle)' }}
          >
            <ChevronRight
              size={11}
              style={{ transform: advancedOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
            />
            Advanced
          </button>
          {advancedOpen && (
            <div className="rounded-lg p-4 space-y-4"
                 style={{ background: 'var(--color-bg-soft)', border: '1px solid var(--color-border)' }}>
              <div>
                <div className="text-xs mb-1" style={{ color: 'var(--color-text-subtle)' }}>Model</div>
                <input
                  defaultValue={agent.model ?? ''}
                  onBlur={(e) => k.updateAgent(agent.id, { model: e.target.value })}
                  placeholder="x-ai/grok-4-fast"
                  className="w-full text-sm mono px-2 py-1.5 rounded outline-none"
                  style={{
                    background: 'var(--color-bg-strong)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                />
              </div>
              <div className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>
                Tools and skills attach via <code className="mono">k.updateAgent(id, {'{ tools, skillIds }'})</code> for now —
                a UI picker lands in the next pass.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Right rail: triggers + recent runs ── */}
      <aside className="overflow-auto p-6"
             style={{ background: 'var(--color-bg-soft)', borderLeft: '1px solid var(--color-border)' }}>
        <SectionLabel>Triggers</SectionLabel>
        <button
          onClick={async () => {
            const type = await appPrompt('Trigger type? (cron, webhook, event, gmail, agent_change)', 'cron')
            if (!type) return
            const cfgRaw = await appPrompt('Config JSON?', type === 'cron' ? '{"schedule":"0 */15 * * * *"}' : '{}')
            if (!cfgRaw) return
            await k.setTrigger(agent.id, type, JSON.parse(cfgRaw))
            setRefresh((n) => n + 1)
          }}
          className="text-xs flex items-center gap-1 mb-5"
          style={{ color: 'var(--color-accent)' }}
        ><Plus size={12} /> Add trigger</button>

        <SectionLabel>Recent runs</SectionLabel>
        <div className="space-y-2">
          {recentRuns.map((r) => (
            <div key={r.id} className="text-xs rounded-md p-2"
                 style={{ background: 'var(--color-bg-strong)', border: '1px solid var(--color-border)' }}>
              <div className="flex items-center gap-2">
                <span className="mono" style={{
                  color: r.status === 'success' ? 'var(--color-success)' :
                         r.status === 'failed'  ? 'var(--color-danger)'  :
                         'var(--color-text-subtle)',
                }}>
                  {r.status}
                </span>
                <span style={{ color: 'var(--color-text-subtle)' }}>
                  {r.startedAt.split('T')[1]?.split('.')[0]}
                </span>
              </div>
              {r.scriptLogs && r.scriptLogs.length > 0 && (
                <div className="mt-1 mono" style={{ color: 'var(--color-text-muted)' }}>
                  {r.scriptLogs.slice(0, 3).map((l, i) => <div key={i} className="truncate">· {l}</div>)}
                </div>
              )}
            </div>
          ))}
          {recentRuns.length === 0 && (
            <div className="text-xs italic" style={{ color: 'var(--color-text-subtle)' }}>No runs yet.</div>
          )}
        </div>

        {triggers.length > 0 && <pre className="text-[10px] mt-4">{JSON.stringify(triggers, null, 2)}</pre>}
      </aside>

      <AgentPlannerChatHost
        open={plannerOpen}
        agent={agent}
        onClose={() => setPlannerOpen(false)}
        onApplied={(updated, nextMode) => {
          setAgent(updated)
          setMode(nextMode)
          setSystemPrompt(updated.systemPrompt   ?? '')
          setScript(updated.compiledScript ?? '')
          window.dispatchEvent(new CustomEvent('os:toast', { detail: `Planned as ${nextMode}` }))
        }}
      />
    </div>
  )
}

function ModeCard({
  active, icon, title, hint, onClick,
}: { active: boolean; icon: string; title: string; hint: string; onClick: () => void }) {
  return (
    <motion.button
      whileHover={{ y: -2 }}
      transition={{ duration: 0.10 }}
      onClick={onClick}
      className="text-left rounded-xl p-4"
      style={{
        background:  active ? 'var(--color-accent-soft)' : 'var(--color-bg-soft)',
        border: '1.5px solid ' + (active ? 'var(--color-accent)' : 'var(--color-border)'),
        color: active ? 'var(--color-accent)' : 'var(--color-text)',
        minHeight: 110,
      }}
    >
      <div className="text-xl mb-1.5">{icon}</div>
      <div className="font-semibold text-sm mb-1">{title}</div>
      <div className="text-[11px] leading-snug"
           style={{ color: active ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>
        {hint}
      </div>
    </motion.button>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] uppercase tracking-wider font-semibold mb-2"
         style={{ color: 'var(--color-text-subtle)' }}>
      {children}
    </div>
  )
}

