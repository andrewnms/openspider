/**
 * Minimal streaming chat-completions client.
 *
 * Speaks the OpenAI v1 chat-completions wire format (POST /chat/completions
 * with SSE response). That's the de-facto standard the user's BYO LLM almost
 * certainly serves: OpenAI, Groq, Together, OpenRouter, Ollama, LM Studio,
 * vLLM, llama.cpp's `--api`, and most local inference servers all conform.
 *
 * We deliberately avoid the Vercel AI SDK — it'd add 200kb and pin us to
 * a specific message shape. fetch + a small SSE parser is enough.
 */

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type AIConfig = {
  /** Base URL like "https://api.openai.com/v1" or "http://localhost:11434/v1". */
  endpoint: string
  /** Model id ("gpt-4o-mini", "llama-3.3-70b-versatile", "qwen2.5:7b", …). */
  model:    string
  /** Optional API key. Some local servers (Ollama, LM Studio) accept anything. */
  apiKey?:  string
  /** 0–2; 0.7 is a reasonable creative default. */
  temperature?: number
}

const SETTINGS_KEY = 'os.ai.config.v1'

const DEFAULT: AIConfig = {
  endpoint: 'https://api.openai.com/v1',
  model:    'gpt-4o-mini',
  apiKey:   '',
  temperature: 0.7,
}

export function loadAIConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT
    const parsed = JSON.parse(raw)
    return { ...DEFAULT, ...parsed }
  } catch { return DEFAULT }
}

export function saveAIConfig(cfg: AIConfig) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(cfg)) } catch { /* */ }
}

export function isAIConfigured(): boolean {
  const c = loadAIConfig()
  // Local endpoints don't need an apiKey, so just require endpoint + model.
  return !!c.endpoint && !!c.model
}

/**
 * Stream a chat completion. Calls `onDelta` for every token chunk; returns
 * the full assembled string when done. Throws on HTTP/network errors.
 *
 * Cancel by passing an AbortSignal — we forward it to fetch.
 */
export async function streamChat(
  messages: ChatMessage[],
  onDelta:  (delta: string) => void,
  opts:     { signal?: AbortSignal; cfg?: AIConfig } = {},
): Promise<string> {
  const cfg = opts.cfg ?? loadAIConfig()

  const url = `${cfg.endpoint.replace(/\/+$/, '')}/chat/completions`
  const resp = await fetch(url, {
    method: 'POST',
    signal: opts.signal,
    headers: {
      'Content-Type': 'application/json',
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      stream: true,
      temperature: cfg.temperature ?? 0.7,
    }),
  })

  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    throw new Error(`AI HTTP ${resp.status}: ${body.slice(0, 300)}`)
  }
  if (!resp.body) throw new Error('AI: empty response stream')

  const reader  = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full   = ''

  // Standard SSE loop — split on `\n\n` for events, each event is one or more
  // `data: …` lines. The `data: [DONE]` sentinel signals end-of-stream.
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let idx
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const event = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)

      for (const line of event.split('\n')) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') return full
        if (!data) continue
        try {
          const json = JSON.parse(data)
          const delta = json?.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta) {
            full += delta
            onDelta(delta)
          }
        } catch {
          // Some servers send non-JSON heartbeat lines; just skip them.
        }
      }
    }
  }
  return full
}

/* ────────── Action presets ──────────────────────────────────────────── */

export type AIAction = {
  id:      string
  label:   string
  hint?:   string
  /** Build the chat messages from the user's selection + surrounding context. */
  build: (input: { selection: string; context?: string; promptOverride?: string }) => ChatMessage[]
  /** How the response gets placed back into the editor. */
  mode:  'replace' | 'append' | 'insertAfter'
}

const SYSTEM = (extra = '') =>
  `You are a writing assistant inside a Notion-style block editor. Output the requested text directly — no preamble, no explanations, no markdown fences. Match the tone of the surrounding context. ${extra}`.trim()

export const AI_ACTIONS: AIAction[] = [
  {
    id: 'continue',
    label: 'Continue writing',
    hint:  'Pick up where the cursor left off',
    mode:  'append',
    build: ({ selection, context }) => [
      { role: 'system', content: SYSTEM('Write 2–4 sentences that naturally continue the document.') },
      { role: 'user',   content: `Document so far:\n\n${context ?? selection}` },
    ],
  },
  {
    id: 'summarize',
    label: 'Extract summary',
    hint:  'Concise summary of the selection',
    mode:  'insertAfter',
    build: ({ selection }) => [
      { role: 'system', content: SYSTEM('Summarise the user\'s text in 2–4 bullet points.') },
      { role: 'user',   content: selection },
    ],
  },
  {
    id: 'brainstorm',
    label: 'Brainstorm',
    hint:  'Generate 5 related ideas',
    mode:  'insertAfter',
    build: ({ selection }) => [
      { role: 'system', content: SYSTEM('Generate exactly 5 short, distinct ideas as a bulleted list.') },
      { role: 'user',   content: `Topic: ${selection}` },
    ],
  },
  {
    id: 'fix-grammar',
    label: 'Fix grammar, spelling and typos',
    hint:  'Light edit, preserve voice',
    mode:  'replace',
    build: ({ selection }) => [
      { role: 'system', content: SYSTEM('Fix grammar, spelling, and typos. Preserve the original voice exactly. Output only the corrected text.') },
      { role: 'user',   content: selection },
    ],
  },
  {
    id: 'rewrite',
    label: 'Rewrite',
    hint:  'Rephrase, clearer + tighter',
    mode:  'replace',
    build: ({ selection }) => [
      { role: 'system', content: SYSTEM('Rewrite the user\'s text to be clearer and tighter. Same meaning, same voice, better prose.') },
      { role: 'user',   content: selection },
    ],
  },
  {
    id: 'custom',
    label: 'Custom action…',
    hint:  'Your own prompt',
    mode:  'insertAfter',
    build: ({ selection, promptOverride }) => [
      { role: 'system', content: SYSTEM() },
      { role: 'user',   content: `${promptOverride ?? 'Help me with this:'}\n\n${selection}` },
    ],
  },
]
