/**
 * First-launch workspace picker.
 *
 * Shown once when `os.workspace.chosen` localStorage flag is missing.
 * Lets the user accept the default vault path or open a custom one.
 *
 * For v1 we only support the default vault (the Tauri kernel writes there
 * already). Custom-folder selection is wired through Tauri's dialog plugin
 * if available; otherwise we just acknowledge the default and mark the
 * flag as set so this never shows again.
 */
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Folder, Sparkles, X } from '../lib/icons'
import { invoke } from '@tauri-apps/api/core'

const FLAG = 'os.workspace.chosen'

export function WorkspacePicker() {
  const [open, setOpen] = useState(false)
  const [vaultPath, setVaultPath] = useState<string | null>(null)

  useEffect(() => {
    if (typeof localStorage === 'undefined') return
    const seen = localStorage.getItem(FLAG)
    if (seen) return
    setOpen(true)
    // Best-effort fetch of the default vault path so we can show the user
    // exactly where their data lives.
    invoke<string>('get_vault_path').then(setVaultPath).catch(() => {
      setVaultPath(null)
    })
  }, [])

  function accept() {
    try { localStorage.setItem(FLAG, '1') } catch { /* */ }
    setOpen(false)
  }

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[200] grid place-items-center no-drag"
          style={{ background: 'rgba(15,15,15,0.45)', backdropFilter: 'blur(2px)' }}
          onClick={accept}
          onKeyDown={(e) => { if (e.key === 'Escape') accept() }}
        >
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0,  scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-[560px] max-w-[92vw] relative"
            style={{
              background: 'var(--color-bg-strong)',
              border: '1px solid var(--color-border)',
              borderRadius: '0.5rem',
              boxShadow: '0 24px 48px -12px rgba(15,15,15,0.32)',
            }}
          >
            {/* Always-available dismiss in case anything below misbehaves */}
            <button
              onClick={accept}
              className="absolute top-3 right-3 w-7 h-7 grid place-items-center rounded-md hover:bg-[var(--color-border-soft)]"
              style={{ color: 'var(--color-text-subtle)' }}
              title="Close (Esc)"
            >
              <X size={14} />
            </button>
            {/* Hero */}
            <div className="px-8 pt-8 pb-2 flex flex-col items-center text-center">
              <div className="w-14 h-14 rounded-xl grid place-items-center text-white mb-4"
                   style={{ background: 'var(--color-text)' }}>
                <span style={{ fontSize: 28, lineHeight: 1 }}>🕷</span>
              </div>
              <h1 className="text-xl font-bold tracking-tight">Welcome to OpenSpider</h1>
              <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
                Your local-first knowledge brain. Pick where to keep your vault.
              </p>
            </div>

            {/* Workspace info */}
            <div className="px-8 pt-4 pb-2">
              <div className="text-[11px] uppercase tracking-wider font-semibold mb-2"
                   style={{ color: 'var(--color-text-subtle)' }}>📂 Workspace</div>
              <div className="flex items-center gap-3 px-3 py-3 rounded"
                   style={{
                     background: 'var(--color-bg-soft)',
                     border: '1px solid var(--color-border)',
                   }}>
                <Folder size={18} style={{ color: 'var(--color-accent)' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">Default vault</div>
                  <div className="text-[11px] mono truncate"
                       style={{ color: 'var(--color-text-subtle)' }}>
                    {vaultPath ?? '~/Library/Application Support/OpenSpider/vault'}
                  </div>
                </div>
              </div>
              <p className="text-[11px] mt-2" style={{ color: 'var(--color-text-subtle)' }}>
                Your data stays on this device as plain Markdown. You can switch workspaces
                later from the title bar.
              </p>
            </div>

            {/* Quick perks */}
            <div className="px-8 py-4 grid grid-cols-2 gap-3">
              <Perk
                icon="📝"
                title="Block editor"
                copy="Notion-style blocks, slash menu, drag handles, dark mode."
              />
              <Perk
                icon="🤖"
                title="Local AI agents"
                copy="Run scripted agents on your own LLM. No cloud lock-in."
              />
            </div>

            {/* Footer */}
            <div className="flex justify-end items-center gap-2 px-6 pb-6 pt-2">
              <button
                onClick={accept}
                className="px-4 py-2 text-sm font-medium text-white rounded flex items-center gap-2"
                style={{ background: 'var(--color-accent)' }}
              >
                <Sparkles size={14} />
                Get started
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

function Perk({ icon, title, copy }: { icon: string; title: string; copy: string }) {
  return (
    <div className="px-3 py-3 rounded flex gap-2"
         style={{
           background: 'var(--color-bg-soft)',
           border: '1px solid var(--color-border)',
         }}>
      <span style={{ fontSize: 18 }}>{icon}</span>
      <div className="min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-[11px] leading-snug" style={{ color: 'var(--color-text-muted)' }}>
          {copy}
        </div>
      </div>
    </div>
  )
}
