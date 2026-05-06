/**
 * Agent planner — a back-and-forth chat for designing an agent.
 *
 * The old "Plan with AI" was one-shot: one description → one plan. That
 * never lets you negotiate, ask clarifying questions, or pull in context
 * from existing docs ("look at @[Daily Note Format] and pattern after that").
 * This is the conversational replacement.
 *
 * Flow:
 *   1. Chat bubbles, user + assistant turns, streamed token-by-token.
 *   2. The user can `@` mention any doc in the vault — selected docs become
 *      chips above the input, and their bodies get injected into the next
 *      user message as fenced markdown blocks. Mentions persist across
 *      turns (the assistant remembers them via the conversation history).
 *   3. When the assistant emits a JSON plan block, an "Apply plan" button
 *      surfaces below the message — clicking patches the agent and closes.
 *
 * The system prompt biases the assistant toward asking clarifying
 * questions before committing to a plan, and toward "prompt" mode unless
 * the task obviously needs JS. The same plan-extraction parser as the
 * one-shot version handles ``json blocks`` and bare-JSON fallbacks.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Sparkles, X, ArrowRight, Plus, FileText } from '../lib/icons'
import { k, type Doc, type Agent } from '../lib/mcp'
import { streamChat } from '../lib/ai'

type Mode = 'prompt' | 'script' | 'hybrid'
type ChatRole = 'user' | 'assistant'
type Msg = { role: ChatRole; content: string }
type Mention = { docId: string; title: string }

const PLANNER_SYSTEM_BASE = `You're an agent-design partner inside the OpenSpider Brain app.

Your job: have a SHORT back-and-forth with the user to design one agent.
Aim for 1–3 clarifying questions max before proposing a plan. Do NOT
plan in the dark — ask anything genuinely missing (trigger? destination?
LLM-required vs deterministic?). Don't ask filler questions.

The user can attach existing docs as context via @mentions; when they
do, the doc bodies appear as fenced markdown in their message. Treat
those as authoritative examples the agent should pattern itself after.

Three modes are available, in order of preference:
  - "prompt"  — system-prompt + LLM only. Default for chat-shaped tasks.
  - "script"  — pure JS, no LLM. For deterministic ETL/cron/file ops.
  - "hybrid"  — JS that calls s16.ai(). Only when both clearly needed.

Pick the cheapest mode that works. Do NOT pick "hybrid" if "prompt" alone
would suffice.`

const PLANNER_SCHEMA_NEW = `When you're ready to commit, end your message with a fenced JSON block:

\`\`\`json
{
  "name": "...",                // SHORT, action-oriented
  "description": "...",         // one line, what it does
  "mode": "prompt" | "script" | "hybrid",
  "model": "x-ai/grok-4-fast",
  "systemPrompt": "...",        // for prompt + hybrid
  "compiledScript": "..."       // for script + hybrid
}
\`\`\``

const PLANNER_SCHEMA_EDIT = `When you're ready to commit, end your message with a fenced JSON block:

\`\`\`json
{
  "mode": "prompt" | "script" | "hybrid",
  "model": "x-ai/grok-4-fast",
  "systemPrompt": "...",        // for prompt + hybrid
  "compiledScript": "..."       // for script + hybrid
}
\`\`\``

const PLANNER_TAIL = `

Only emit one JSON block when you're actually proposing a plan. While
you're still asking questions, just write prose.

Compiled scripts run in node:vm with a global \`s16\` API (s16.log,
s16.ai, s16.docs.{list,get,create,update}, s16.http, s16.store, etc.)
and a \`context\` object. Return any JSON-serialisable value.`

export function AgentPlannerChat({
  agent, onClose, onApplied,
}: {
  /** Existing agent to refine, or `null` to design + create one from scratch. */
  agent: Agent | null
  onClose: () => void
  onApplied: (updated: Agent, mode: Mode) => void
}) {
  const isNew = agent === null
  const [docs, setDocs] = useState<Doc[]>([])
  const [messages, setMessages] = useState<Msg[]>(() => seed(agent))
  const [draft, setDraft]     = useState('')
  const [mentions, setMentions] = useState<Mention[]>([])
  const [streaming, setStreaming] = useState(false)
  const [streamBuf, setStreamBuf] = useState('')
  const [mentionPicker, setMentionPicker] = useState(false)
  const [pickerQuery, setPickerQuery]     = useState('')
  const [applying, setApplying] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef     = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { k.listAllDocs().then(setDocs).catch(() => setDocs([])) }, [])

  // Auto-scroll on new content.
  useEffect(() => {
    const el = scrollRef.current; if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, streamBuf])

  // Filter docs for the @ picker. Cap at 6 so the popover stays compact.
  const pickerHits = useMemo(() => {
    const q = pickerQuery.toLowerCase().trim()
    const taken = new Set(mentions.map((m) => m.docId))
    const pool = docs.filter((d) => !taken.has(d.id))
    if (!q) return pool.slice(0, 6)
    return pool.filter((d) => d.title.toLowerCase().includes(q)).slice(0, 6)
  }, [docs, pickerQuery, mentions])

  function addMention(d: Doc) {
    setMentions((xs) => xs.some((m) => m.docId === d.id) ? xs : [...xs, { docId: d.id, title: d.title }])
    setMentionPicker(false); setPickerQuery('')
    setTimeout(() => taRef.current?.focus(), 0)
  }

  /** Send the current draft + mentions. Pulls each mention's body so the
   *  assistant has the same context a human collaborator would. */
  async function send() {
    if (streaming) return
    const text = draft.trim()
    const ms   = mentions.slice()
    if (!text && ms.length === 0) return

    // Pull doc bodies in parallel so the user message is self-contained.
    let contextBlock = ''
    if (ms.length > 0) {
      const bodies = await Promise.all(ms.map(async (m) => {
        try {
          const html = await k.getDocContent(m.docId)
          const txt = (typeof html === 'string' ? html : '')
            .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
          return { title: m.title, body: txt.slice(0, 4000) }
        } catch { return { title: m.title, body: '(could not load)' } }
      }))
      contextBlock = bodies.map((b) =>
        `\n\n---\n📎 **@${b.title}**\n\n\`\`\`\n${b.body}\n\`\`\``,
      ).join('')
    }

    const userMsg: Msg = { role: 'user', content: text + contextBlock }
    const next: Msg[] = [...messages, userMsg]
    setMessages(next); setDraft(''); setMentions([])
    setStreaming(true); setStreamBuf('')
    try {
      let acc = ''
      const sys = PLANNER_SYSTEM_BASE +
        '\n\n' + (isNew ? PLANNER_SCHEMA_NEW : PLANNER_SCHEMA_EDIT) +
        PLANNER_TAIL
      const full = await streamChat(
        [{ role: 'system', content: sys },
         ...next.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))],
        (delta) => { acc += delta; setStreamBuf(acc) },
      )
      setMessages((xs) => [...xs, { role: 'assistant', content: full }])
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setMessages((xs) => [...xs, { role: 'assistant', content: `❌ ${msg}` }])
    } finally {
      setStreaming(false); setStreamBuf('')
    }
  }

  /** Find the latest plan JSON across assistant messages. */
  const latestPlan = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role !== 'assistant') continue
      const p = extractPlan(messages[i].content)
      if (p && (p.systemPrompt || p.compiledScript)) return p
    }
    return null
  }, [messages])

  async function applyPlan() {
    if (!latestPlan) return
    setApplying(true)
    try {
      let saved: Agent
      if (isNew) {
        // Plan must include a name when creating from scratch — fall back to
        // a placeholder rather than failing if the model forgot.
        saved = await k.createAgent({
          name:           latestPlan.name        ?? 'Untitled agent',
          description:    latestPlan.description ?? '',
          model:          latestPlan.model       ?? 'x-ai/grok-4-fast',
          systemPrompt:   latestPlan.systemPrompt ?? '',
          compiledScript: latestPlan.compiledScript ?? '',
        })
      } else {
        const patch: Partial<Agent> = {}
        if (latestPlan.name           !== undefined) patch.name           = latestPlan.name
        if (latestPlan.description    !== undefined) patch.description    = latestPlan.description
        if (latestPlan.systemPrompt   !== undefined) patch.systemPrompt   = latestPlan.systemPrompt
        if (latestPlan.compiledScript !== undefined) patch.compiledScript = latestPlan.compiledScript
        if (latestPlan.model)                         patch.model          = latestPlan.model
        saved = await k.updateAgent(agent!.id, patch)
      }
      const mode: Mode = latestPlan.mode ?? inferMode(saved)
      onApplied(saved, mode)
      onClose()
    } finally { setApplying(false) }
  }

  function onTaKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); send(); return
    }
    if (e.key === '@') {
      // Defer one tick so the @ has been inserted into the textarea first.
      setTimeout(() => setMentionPicker(true), 0)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className="fixed inset-0 z-[150] grid place-items-center"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, y: 8 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 8 }}
        transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="w-[760px] max-w-[94vw] h-[680px] max-h-[88vh] flex flex-col shadow-2xl"
        style={{
          background: 'var(--color-bg-strong)',
          border: '1px solid var(--color-border)',
          borderRadius: 12,
        }}
      >
        <header className="px-5 py-3 flex items-center gap-3 shrink-0"
                style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="w-8 h-8 grid place-items-center rounded-lg"
               style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}>
            <Sparkles size={15} />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold">
              {isNew ? 'Design a new agent' : `Plan agent · ${agent!.name}`}
            </div>
            <div className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>
              Chat to design it. Use <code className="mono">@</code> to attach docs as context.
            </div>
          </div>
          <button onClick={onClose}
                  className="w-7 h-7 grid place-items-center rounded hover:bg-[var(--color-border-soft)]"
                  style={{ color: 'var(--color-text-muted)' }}>
            <X size={14} />
          </button>
        </header>

        {/* Conversation */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.map((m, i) => (
            <Bubble key={i} role={m.role}
                    isLatest={i === messages.length - 1}
                    showApply={!!latestPlan && i === messages.length - 1 && m.role === 'assistant'}
                    plan={latestPlan}
                    applying={applying}
                    onApply={applyPlan}>
              {m.content}
            </Bubble>
          ))}
          {streaming && (
            <Bubble role="assistant" streaming>
              {streamBuf || '…'}
            </Bubble>
          )}
        </div>

        {/* Mentions strip + composer */}
        <footer className="shrink-0 p-3"
                style={{ borderTop: '1px solid var(--color-border)' }}>
          {mentions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {mentions.map((m) => (
                <span key={m.docId}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs"
                      style={{
                        background: 'var(--color-accent-soft)',
                        color: 'var(--color-accent)',
                        border: '1px solid color-mix(in oklab, var(--color-accent) 30%, transparent)',
                      }}>
                  <FileText size={11} />
                  {m.title}
                  <button onClick={() => setMentions((xs) => xs.filter((x) => x.docId !== m.docId))}
                          className="opacity-60 hover:opacity-100">
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="relative flex items-end gap-2">
            <button
              onClick={() => setMentionPicker((v) => !v)}
              title="Attach a doc as context"
              className="w-8 h-8 grid place-items-center rounded shrink-0"
              style={{
                background: 'var(--color-bg-soft)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-muted)',
              }}
            >
              <Plus size={14} />
            </button>
            <textarea
              ref={taRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                // If they just typed @, auto-open the picker.
                if (e.target.value.endsWith('@')) setMentionPicker(true)
              }}
              onKeyDown={onTaKey}
              placeholder="Tell me what this agent should do… (Enter to send, @ to attach a doc)"
              className="flex-1 text-sm rounded-lg p-2.5 outline-none"
              style={{
                background: 'var(--color-bg-soft)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
                minHeight: 44, maxHeight: 140, resize: 'none',
              }}
              rows={1}
            />
            <motion.button
              whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
              transition={{ duration: 0.08 }}
              onClick={send}
              disabled={streaming || (!draft.trim() && mentions.length === 0)}
              className="h-8 px-3 grid place-items-center rounded font-medium text-white text-xs disabled:opacity-50"
              style={{ background: 'var(--color-accent)' }}
            >
              <ArrowRight size={14} />
            </motion.button>

            {mentionPicker && (
              <div
                className="absolute bottom-full left-0 mb-2 w-72 max-h-72 overflow-y-auto py-1 shadow-xl"
                style={{
                  background: 'var(--color-bg-strong)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <input
                  autoFocus
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { setMentionPicker(false); return }
                    if (e.key === 'Enter' && pickerHits[0]) { e.preventDefault(); addMention(pickerHits[0]) }
                  }}
                  placeholder="Search docs…"
                  className="w-full text-xs px-3 py-2 outline-none mono"
                  style={{
                    background: 'transparent', color: 'var(--color-text)',
                    borderBottom: '1px solid var(--color-border-soft)',
                  }}
                />
                {pickerHits.length === 0 && (
                  <div className="px-3 py-2 text-xs italic"
                       style={{ color: 'var(--color-text-subtle)' }}>
                    No matching docs.
                  </div>
                )}
                {pickerHits.map((d) => (
                  <button key={d.id}
                          onClick={() => addMention(d)}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-[var(--color-border-soft)]">
                    <span style={{ width: 14, textAlign: 'center' }}>{d.icon ?? '📄'}</span>
                    <span className="truncate">{d.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </footer>
      </motion.div>
    </motion.div>
  )
}

function Bubble({
  role, children, streaming, showApply, plan, applying, onApply,
}: {
  role: ChatRole
  children: React.ReactNode
  streaming?: boolean
  isLatest?: boolean
  showApply?: boolean
  plan?: { name?: string; mode?: Mode; systemPrompt?: string; compiledScript?: string } | null
  applying?: boolean
  onApply?: () => void
}) {
  const text = typeof children === 'string' ? children : ''
  // Strip the JSON code block from display — we already render an Apply
  // affordance for it. Keeps the visible message focused on the prose.
  const visible = text.replace(/```(?:json)?\s*[\s\S]*?```/g, '').trim()
  const isUser = role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[78%]">
        <div
          className="text-sm px-3.5 py-2.5 rounded-2xl whitespace-pre-wrap leading-relaxed"
          style={{
            background: isUser ? 'var(--color-accent)' : 'var(--color-bg-soft)',
            color:      isUser ? '#fff'                : 'var(--color-text)',
            border:     isUser ? 'none' : '1px solid var(--color-border)',
            borderTopRightRadius:  isUser ? 4 : 16,
            borderTopLeftRadius:   isUser ? 16 : 4,
          }}
        >
          {visible || (streaming ? <span style={{ opacity: 0.5 }}>thinking…</span> : '(empty)')}
          {streaming && <span className="inline-block ml-1 animate-pulse">▍</span>}
        </div>
        {showApply && plan && onApply && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className="mt-2 rounded-lg p-3"
            style={{
              background: 'var(--color-bg-strong)',
              border: '1px solid var(--color-accent)',
            }}
          >
            <div className="text-[11px] uppercase tracking-wider font-semibold mb-1"
                 style={{ color: 'var(--color-accent)' }}>Plan ready</div>
            <div className="text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>
              {plan.name && <><span className="font-semibold" style={{ color: 'var(--color-text)' }}>{plan.name}</span> · </>}
              <span className="mono">mode: {plan.mode ?? 'prompt'}</span>
              {plan.systemPrompt && <> · prompt {plan.systemPrompt.length} ch</>}
              {plan.compiledScript && <> · script {plan.compiledScript.length} ch</>}
            </div>
            <button
              onClick={onApply}
              disabled={applying}
              className="text-xs px-3 py-1.5 rounded-md font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--color-accent)' }}
            >
              {applying ? 'Applying…' : 'Apply plan to agent'}
            </button>
          </motion.div>
        )}
      </div>
    </div>
  )
}

/* ────────── helpers ────────── */

function seed(agent: Agent | null): Msg[] {
  if (agent === null) {
    // Create-from-scratch: skip the intro, jump straight to the prompt that
    // shows the user where to start typing. The assistant's first turn
    // doubles as a placeholder/guide.
    return [
      { role: 'assistant', content: "What should this agent do? Describe it in your own words — I'll help you name it, pick the right mode (just-LLM, just-script, or hybrid), and write the prompt or code. Mention existing docs with **@** if you want me to pattern-match an example." },
    ]
  }
  const intro = agent.description?.trim()
    ? `I'd like to design an agent called **${agent.name}**.\n\nWhat I have so far: ${agent.description}`
    : `I'd like to design an agent called **${agent.name}**. I haven't written a description yet.`
  return [
    { role: 'user',      content: intro },
    { role: 'assistant', content: 'Got it — what should this agent actually do, end-to-end? Mention any specific docs that show the pattern you want (use the **@** button below).' },
  ]
}

function extractPlan(raw: string): {
  name?: string; description?: string;
  mode?: Mode; model?: string;
  systemPrompt?: string; compiledScript?: string;
} | null {
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = m ? m[1] : raw
  try { return JSON.parse(body) }
  catch {
    const i = raw.indexOf('{'), j = raw.lastIndexOf('}')
    if (i >= 0 && j > i) {
      try { return JSON.parse(raw.slice(i, j + 1)) } catch { return null }
    }
    return null
  }
}

function inferMode(agent: Agent): Mode {
  const hasScript = !!(agent.compiledScript && agent.compiledScript.trim())
  const hasPrompt = !!(agent.systemPrompt   && agent.systemPrompt.trim())
  if (hasScript && hasPrompt) return 'hybrid'
  if (hasScript)              return 'script'
  return 'prompt'
}

export function AgentPlannerChatHost(props: {
  open: boolean
  /** Pass an Agent to refine, or `null` to design + create one. */
  agent: Agent | null
  onClose: () => void
  onApplied: (saved: Agent, mode: Mode) => void
}) {
  return (
    <AnimatePresence>
      {props.open && (
        <AgentPlannerChat
          agent={props.agent}
          onClose={props.onClose}
          onApplied={props.onApplied}
        />
      )}
    </AnimatePresence>
  )
}
