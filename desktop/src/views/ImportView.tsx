/**
 * Import view — bulk-create docs from JSON / NDJSON / chat exports.
 *
 * The user pastes raw text + picks a parser. Each parser yields
 * `{ title, body, icon? }[]` records that we feed straight into
 * `k.createDoc` in parallel. Imports a chat-export style payload (an
 * array of conversations or messages) the same way bettersync does.
 *
 * Why we ship this in OpenSpider directly: previously you needed a
 * separate `bettersync ingest …` CLI invocation to load a chat dump.
 * Inlining the parsers here means you only need to download ONE app,
 * and the import is one paste away.
 */
import { useState } from 'react'
import { motion } from 'motion/react'
import { Save as ArrowDownTray, Sparkles } from '../lib/icons'
import { k } from '../lib/mcp'

type Parsed = { title: string; body: string; icon?: string }
type Format = 'jsonArray' | 'ndjson' | 'chatMessages' | 'whatsapp' | 'plainList'

const FORMATS: { id: Format; label: string; sub: string }[] = [
  { id: 'jsonArray',    label: 'JSON array of {title, body}', sub: 'Each object becomes one doc.' },
  { id: 'ndjson',       label: 'NDJSON (one object per line)', sub: 'Same as JSON array but newline-delimited.' },
  { id: 'chatMessages', label: 'Chat messages [{from, text, ts?}]',  sub: 'Bundled into a single conversation doc.' },
  { id: 'whatsapp',     label: 'WhatsApp text export (_chat.txt)',   sub: 'Paste the contents of an exported chat .txt.' },
  { id: 'plainList',    label: 'Plain text — one title per line',    sub: 'Empty docs with the line as title.' },
]

export function ImportView() {
  const [text,    setText]    = useState('')
  const [format,  setFormat]  = useState<Format>('jsonArray')
  const [running, setRunning] = useState(false)
  const [result,  setResult]  = useState<{ ok: number; failed: number; titles: string[] } | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  async function run() {
    setError(null); setResult(null); setRunning(true)
    try {
      const parsed = parseInput(text, format)
      const titles: string[] = []
      let ok = 0, failed = 0
      // Sequential to keep frontmatter title-uniqueness reliable; the
      // backend dedupes filenames but parallel fan-out under the same
      // title produces auto-suffixed copies in unpredictable order.
      for (const p of parsed) {
        try {
          const doc = await k.createDoc(p.title, { icon: p.icon ?? '📥', content: p.body })
          titles.push(doc.title); ok++
        } catch (e) {
          console.error('import row failed', e); failed++
        }
      }
      setResult({ ok, failed, titles })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="h-full overflow-auto px-8 py-10" style={{ background: 'var(--color-bg-strong)' }}>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center mb-6">
          <div className="w-10 h-10 grid place-items-center rounded-lg mr-3"
               style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}>
            <ArrowDownTray size={20} />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold leading-tight">Import</h1>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Paste data, pick a format, get docs. Replaces <code className="mono text-xs">bettersync ingest</code>.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
          {FORMATS.map((f) => (
            <motion.button
              key={f.id}
              onClick={() => setFormat(f.id)}
              whileHover={{ y: -1 }}
              transition={{ duration: 0.08 }}
              className="text-left rounded-lg p-3"
              style={{
                background: format === f.id ? 'var(--color-accent-soft)' : 'var(--color-bg-soft)',
                border: '1px solid ' + (format === f.id ? 'var(--color-accent)' : 'var(--color-border)'),
                color: format === f.id ? 'var(--color-accent)' : 'var(--color-text)',
              }}
            >
              <div className="text-sm font-medium">{f.label}</div>
              <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>{f.sub}</div>
            </motion.button>
          ))}
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={PLACEHOLDERS[format]}
          spellCheck={false}
          className="w-full mono text-xs p-3 rounded-lg outline-none"
          style={{
            background: 'var(--color-bg-soft)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text)',
            minHeight: 280,
            resize: 'vertical',
          }}
        />

        <div className="mt-4 flex items-center gap-3">
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            transition={{ duration: 0.08 }}
            onClick={run}
            disabled={running || !text.trim()}
            className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-md font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--color-accent)' }}
          >
            <Sparkles size={13} />
            {running ? 'Importing…' : 'Run import'}
          </motion.button>
          <span className="text-xs" style={{ color: 'var(--color-text-subtle)' }}>
            Each row becomes a top-level doc. Reorganise after with drag-drop.
          </span>
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-lg text-sm"
               style={{
                 background: 'var(--color-bg-soft)',
                 border: '1px solid var(--color-danger)',
                 color: 'var(--color-danger)',
               }}>
            {error}
          </div>
        )}

        {result && (
          <div className="mt-4 p-4 rounded-lg"
               style={{
                 background: 'var(--color-bg-soft)',
                 border: '1px solid var(--color-success)',
               }}>
            <div className="text-sm font-medium mb-1">
              ✓ Imported {result.ok} doc{result.ok === 1 ? '' : 's'}
              {result.failed > 0 && (
                <span style={{ color: 'var(--color-danger)' }}> ({result.failed} failed)</span>
              )}
            </div>
            {result.titles.length > 0 && (
              <div className="text-xs mt-2" style={{ color: 'var(--color-text-muted)' }}>
                Created: {result.titles.slice(0, 8).join(' · ')}
                {result.titles.length > 8 && ` · +${result.titles.length - 8} more`}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const PLACEHOLDERS: Record<Format, string> = {
  jsonArray: `[
  { "title": "Strategy notes", "body": "## Q3\\n- Ship onboarding..." },
  { "title": "Recipe inbox",  "body": "Saw a great daal stew recipe..." }
]`,
  ndjson: `{"title":"Strategy notes","body":"## Q3..."}
{"title":"Recipe inbox","body":"Saw a daal stew..."}`,
  chatMessages: `[
  { "from": "Aime", "text": "Hey", "ts": "2024-09-01T08:00:00Z" },
  { "from": "Me",   "text": "Yo!", "ts": "2024-09-01T08:00:30Z" }
]`,
  whatsapp: `[12/31/22, 11:59:59 PM] Jane Doe: Hey there
[12/31/22, 11:59:59 PM] John Doe: Yo
[1/1/23, 12:00:01 AM] Jane Doe: multi-line messages
just wrap onto the next line`,
  plainList: `Strategy notes
Recipe inbox
Reading list
Project: KB rebuild`,
}

/* ────────── Parsers ────────── */
function parseInput(raw: string, format: Format): Parsed[] {
  const text = raw.trim()
  if (!text) throw new Error('Paste something first.')
  switch (format) {
    case 'jsonArray':    return parseJsonArray(text)
    case 'ndjson':       return parseNdjson(text)
    case 'chatMessages': return parseChatMessages(text)
    case 'whatsapp':     return parseWhatsapp(text)
    case 'plainList':    return parsePlainList(text)
  }
}

/* WhatsApp text export parser — port of bettersync's parsers/whatsapp.mjs.
   The file system traversal half doesn't apply here (the user pastes the
   raw .txt contents), so this is just the line-based message decoder. */

const RE_BRACKETED   = /^\[(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?\]\s*(.*?)$/
const RE_UNBRACKETED = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?\s*[-–]\s*(.*?)$/

function parseWhatsapp(text: string): Parsed[] {
  const lines = text.split(/\r?\n/)
  type Msg = { tsIso: string; sender: string | null; body: string[] }
  const messages: Msg[] = []
  let current: Msg | null = null

  for (const rawLine of lines) {
    const line = rawLine.replace(/‎|‏/g, '')  // strip LRM/RLM
    const head = parseWhatsappHeader(line)
    if (head) {
      if (current) messages.push(current)
      current = {
        tsIso: head.tsIso,
        sender: head.sender,
        body:   head.body ? [head.body] : [],
      }
    } else if (current) {
      current.body.push(line)
    }
  }
  if (current) messages.push(current)
  if (messages.length === 0) {
    throw new Error('No WhatsApp-format lines detected. Lines must start with a [date, time] prefix.')
  }

  // Format the conversation as a markdown doc, oldest-first.
  const md = messages.map((m) => {
    const ts = new Date(m.tsIso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
    const body = m.body.join('\n').trim()
    return `**${m.sender ?? '·system·'}** &middot; ${ts}\n\n${body}`
  }).join('\n\n---\n\n')

  // Title from the first sender (best guess) and the first message's date.
  const firstSender = messages.find((m) => m.sender)?.sender ?? 'WhatsApp'
  const firstDate   = messages[0]?.tsIso?.slice(0, 10) ?? ''
  const title = firstDate ? `${firstSender} — ${firstDate}` : `Conversation with ${firstSender}`

  return [{ title, icon: '💬', body: md }]
}

function parseWhatsappHeader(line: string): { tsIso: string; sender: string | null; body: string } | null {
  const m = RE_BRACKETED.exec(line) ?? RE_UNBRACKETED.exec(line)
  if (!m) return null
  const [, p1, p2, year, hh, mm, ss, ampm, rest] = m
  const tsIso = buildIso(p1, p2, year, hh, mm, ss, ampm)
  if (!tsIso) return null
  // Split "Sender: body" off `rest`. System messages have no colon.
  const colonIdx = rest.indexOf(':')
  let sender: string | null = null, body = rest
  if (colonIdx > 0 && colonIdx < 80) {
    sender = rest.slice(0, colonIdx).trim()
    body   = rest.slice(colonIdx + 1).trim()
  }
  return { tsIso, sender, body }
}

function buildIso(p1: string, p2: string, year: string, hh: string, mm: string, ss?: string, ampm?: string): string | null {
  const a = parseInt(p1, 10), b = parseInt(p2, 10)
  let y = parseInt(year, 10)
  if (y < 100) y += y >= 70 ? 1900 : 2000
  // Heuristic: if either token > 12 the >12 one must be the day.
  let day: number, month: number
  if (a > 12 && b <= 12)      { day = a; month = b }
  else if (b > 12 && a <= 12) { day = b; month = a }
  else                         { day = b; month = a } // ambiguous → mm/dd (US default)
  let hour = parseInt(hh, 10)
  if (ampm) { hour = hour % 12; if (/p/i.test(ampm)) hour += 12 }
  const minute = parseInt(mm, 10)
  const second = ss ? parseInt(ss, 10) : 0
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return new Date(Date.UTC(y, month - 1, day, hour, minute, second)).toISOString()
}

function parseJsonArray(text: string): Parsed[] {
  let data: unknown
  try { data = JSON.parse(text) }
  catch (e) { throw new Error(`JSON parse failed: ${(e as Error).message}`) }
  if (!Array.isArray(data)) throw new Error('Expected a top-level JSON array.')
  return data.map((row, i) => coerce(row, i))
}

function parseNdjson(text: string): Parsed[] {
  const rows: Parsed[] = []
  text.split('\n').forEach((line, i) => {
    const t = line.trim(); if (!t) return
    try { rows.push(coerce(JSON.parse(t), i)) }
    catch (e) { throw new Error(`Line ${i + 1}: ${(e as Error).message}`) }
  })
  return rows
}

function parseChatMessages(text: string): Parsed[] {
  // Bundle the entire array into a single conversation doc. Each message
  // becomes a "[ts] **from**: text" line.
  const data = JSON.parse(text)
  if (!Array.isArray(data)) throw new Error('Expected an array of message objects.')
  const lines = data.map((m: { from?: string; text?: string; ts?: string }) => {
    const ts = m.ts ? `[${m.ts}] ` : ''
    return `${ts}**${m.from ?? '?'}:** ${m.text ?? ''}`
  })
  const first = data[0] as { ts?: string }
  const date = first?.ts ? new Date(first.ts).toISOString().slice(0, 10) : 'untitled'
  return [{
    title: `Conversation ${date}`,
    icon:  '💬',
    body:  lines.join('\n\n'),
  }]
}

function parsePlainList(text: string): Parsed[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean)
    .map((title) => ({ title, body: '', icon: '📥' }))
}

function coerce(row: unknown, idx: number): Parsed {
  if (typeof row !== 'object' || !row) {
    throw new Error(`Row ${idx} is not an object`)
  }
  const r = row as Record<string, unknown>
  const title = String(r.title ?? r.name ?? `Imported ${idx + 1}`)
  const body  = String(r.body ?? r.content ?? r.text ?? '')
  const icon  = typeof r.icon === 'string' ? r.icon : '📥'
  return { title, body, icon }
}
