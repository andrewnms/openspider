/**
 * Flashcard review view — minimal SM-2 implementation.
 *
 * Cards are docs with `flashcard: true` in frontmatter; the queue is the
 * set of those docs whose `cardDue` is past or unset. Front of card =
 * doc title; back = doc body. Four-button rating (Again / Hard / Good /
 * Easy) maps to 1..=4 and persists the new SRS state via s16_review_card.
 *
 * No card means an empty queue with a friendly empty state. Reviewing
 * pulls the next card from the local queue; when the queue empties we
 * refetch from the server in case anything new became due.
 */
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Plus, Bookmark, RefreshCw, FileText } from '../lib/icons'
import { k, type Doc } from '../lib/mcp'
import { store } from '../store'

type Rating = 1 | 2 | 3 | 4

const RATING_LABEL: Record<Rating, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' }
const RATING_HUE:   Record<Rating, string> = {
  1: 'var(--color-danger)', 2: '#d97706', 3: 'var(--color-accent)', 4: 'var(--color-success)',
}

export function CardsView() {
  const [queue,    setQueue]    = useState<Doc[] | null>(null)
  const [showBack, setShowBack] = useState(false)
  const [body,     setBody]     = useState<string>('')
  const [reviewing, setReviewing] = useState(false)

  useEffect(() => { refetch() }, [])

  function refetch() {
    setQueue(null); setShowBack(false); setBody('')
    k.listDueCards().then(setQueue).catch(() => setQueue([]))
  }

  // Pull body for the current card whenever it changes.
  const current = queue && queue[0]
  useEffect(() => {
    if (!current) { setBody(''); return }
    let cancelled = false
    k.getDocContent(current.id).then((html) => {
      if (cancelled) return
      // The MCP returns HTML — strip tags for a quick reading experience.
      const text = (typeof html === 'string' ? html : '')
        .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      setBody(text)
    }).catch(() => { if (!cancelled) setBody('') })
    return () => { cancelled = true }
  }, [current?.id])

  async function rate(r: Rating) {
    if (!current || reviewing) return
    setReviewing(true)
    try {
      await k.reviewCard(current.id, r)
    } catch (e) {
      console.error('review failed', e)
    } finally {
      setReviewing(false)
    }
    // Pop off the front of the queue. If empty, refetch in case more came due.
    setQueue((q) => {
      if (!q) return q
      const next = q.slice(1)
      if (next.length === 0) {
        // Empty — soft refetch in case something else is due.
        k.listDueCards().then(setQueue).catch(() => setQueue([]))
        return null
      }
      return next
    })
    setShowBack(false)
  }

  if (queue === null) return (
    <Centered>Loading review queue…</Centered>
  )
  if (queue.length === 0) return (
    <div className="h-full overflow-auto px-8 py-10" style={{ background: 'var(--color-bg-strong)' }}>
      <div className="max-w-2xl mx-auto text-center">
        <div className="w-16 h-16 mx-auto grid place-items-center rounded-2xl mb-4"
             style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}>
          <Bookmark size={28} />
        </div>
        <h1 className="text-2xl font-bold mb-1">All caught up.</h1>
        <p className="text-sm mb-6" style={{ color: 'var(--color-text-muted)' }}>
          No flashcards are due right now. Mark a doc as a flashcard from its
          More menu (Quick make card) and it'll show up here when due.
        </p>
        <motion.button
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          onClick={refetch}
          className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-md font-medium"
          style={{
            background: 'var(--color-bg-soft)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text)',
          }}
        >
          <RefreshCw size={13} /> Check again
        </motion.button>
      </div>
    </div>
  )

  return (
    <div className="h-full overflow-auto px-8 py-10" style={{ background: 'var(--color-bg-strong)' }}>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center mb-6">
          <div className="w-10 h-10 grid place-items-center rounded-lg mr-3"
               style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}>
            <Bookmark size={20} />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold leading-tight">Review</h1>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {queue.length} card{queue.length === 1 ? '' : 's'} due. Reveal, then rate honestly.
            </p>
          </div>
          <button
            onClick={() => current && store.open({ title: current.title, icon: current.icon, view: { kind: 'doc', docId: current.id } })}
            className="text-xs flex items-center gap-1 px-2 py-1 rounded hover:bg-[var(--color-border-soft)]"
            style={{ color: 'var(--color-text-subtle)' }}
            title="Open the source doc in a tab"
          >
            <FileText size={12} /> Open doc
          </button>
        </div>

        <AnimatePresence mode="wait">
          {current && (
            <motion.div
              key={current.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="rounded-2xl p-8 min-h-[280px] flex flex-col"
              style={{
                background: 'var(--color-bg-soft)',
                border: '1px solid var(--color-border)',
              }}
            >
              <div className="text-2xl font-semibold mb-4 leading-tight">
                {current.icon ?? '📄'} {current.title}
              </div>

              {!showBack ? (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setShowBack(true)}
                  className="self-start text-sm px-3 py-1.5 rounded-md font-medium"
                  style={{ background: 'var(--color-accent)', color: '#fff' }}
                >
                  Reveal answer
                </motion.button>
              ) : (
                <div className="text-base leading-relaxed whitespace-pre-wrap"
                     style={{ color: 'var(--color-text)' }}>
                  {body || <span style={{ color: 'var(--color-text-subtle)' }}>(empty body)</span>}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {showBack && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.14 }}
            className="mt-6 grid grid-cols-4 gap-2"
          >
            {([1, 2, 3, 4] as Rating[]).map((r) => (
              <motion.button
                key={r}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => rate(r)}
                disabled={reviewing}
                className="rounded-lg py-3 text-sm font-semibold disabled:opacity-50"
                style={{
                  background: 'var(--color-bg-soft)',
                  border: `1.5px solid ${RATING_HUE[r]}`,
                  color: RATING_HUE[r],
                }}
              >
                {RATING_LABEL[r]}
                <div className="text-[10px] mt-0.5 mono opacity-70">
                  {r === 1 ? 'reset' : r === 2 ? '+20%' : r === 3 ? '×ease' : '×ease·1.3'}
                </div>
              </motion.button>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full grid place-items-center text-sm"
         style={{ color: 'var(--color-text-subtle)' }}>{children}</div>
  )
}

/** Toggle button for DocView's More menu — "Quick make flashcard". */
export function FlashcardToggle({ doc, onChanged }: {
  doc: Doc; onChanged: (next: Doc) => void
}) {
  const [busy, setBusy] = useState(false)
  const isCard = doc.flashcard === true
  return (
    <motion.button
      whileHover={{ x: 2 }}
      transition={{ duration: 0.08 }}
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          const updated = await k.setDocFlashcard(doc.id, !isCard)
          onChanged(updated)
        } finally { setBusy(false) }
      }}
      className="w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-[var(--color-border-soft)]"
    >
      <span style={{ color: isCard ? 'var(--color-accent)' : 'var(--color-text-subtle)', marginTop: 2 }}>
        <Bookmark size={14} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm" style={{ color: 'var(--color-text)' }}>
          {isCard ? 'Stop flashcarding' : 'Make flashcard'}
        </div>
        <div className="text-[11px] mono truncate" style={{ color: 'var(--color-text-subtle)' }}>
          {isCard
            ? doc.cardDue ? `next: ${new Date(doc.cardDue).toLocaleDateString()}` : 'in review queue'
            : 'add to spaced-repetition queue'}
        </div>
      </div>
      {busy && <span className="text-[10px]" style={{ color: 'var(--color-text-subtle)' }}>…</span>}
      {!busy && !isCard && <Plus size={12} style={{ color: 'var(--color-text-subtle)' }} />}
    </motion.button>
  )
}
