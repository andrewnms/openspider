import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Settings, Key, Globe, Database, Sparkles } from '../lib/icons'
import { call } from '../lib/mcp'
import { loadAIConfig, saveAIConfig, type AIConfig } from '../lib/ai'

export function SettingsView() {
  const [vault, setVault] = useState<string>('')
  const [creds, setCreds] = useState<Array<{ id: string; service: string; title: string; status?: string }>>([])
  const [secrets, setSecrets] = useState<string[]>([])

  useEffect(() => {
    invoke<string>('get_vault_path').then(setVault).catch(() => setVault(''))
    call<typeof creds>('s16_list_credentials').then(setCreds).catch(() => setCreds([]))
    call<{ keys: string[] }>('s16_list_secrets').then((r) => setSecrets(r.keys ?? [])).catch(() => setSecrets([]))
  }, [])

  return (
    <div className="h-full overflow-auto px-8 py-8" style={{ background: 'var(--color-bg-strong)' }}>
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="flex items-center">
          <Settings size={24} className="mr-2" />
          <h1 className="text-2xl font-bold">Settings</h1>
        </div>

        <Card icon={<Database size={16} />} title="Vault">
          <div className="text-sm mono" style={{ color: 'var(--color-text-muted)' }}>{vault || '(loading…)'}</div>
          <div className="text-xs mt-2" style={{ color: 'var(--color-text-subtle)' }}>
            Plain markdown + YAML files on disk. Open with Obsidian, edit with vim, back up with tar.
          </div>
        </Card>

        <Card icon={<Key size={16} />} title="Credentials">
          {creds.length === 0 && <Empty msg="No credentials yet. Add via the bettersync CLI or via s16_create_credential MCP call." />}
          {creds.map((c) => (
            <div key={c.id} className="grid grid-cols-[100px_1fr_80px] gap-3 py-2 text-sm"
                 style={{ borderTop: '1px solid var(--color-border-soft)' }}>
              <span className="mono text-xs" style={{ color: 'var(--color-text-subtle)' }}>{c.service}</span>
              <span>{c.title}</span>
              <span className="text-xs" style={{ color: 'var(--color-success)' }}>{c.status ?? 'active'}</span>
            </div>
          ))}
        </Card>

        <Card icon={<Globe size={16} />} title="Secrets">
          {secrets.length === 0 && <Empty msg="No secrets stored." />}
          {secrets.map((k) => (
            <div key={k} className="py-2 text-sm mono"
                 style={{ borderTop: '1px solid var(--color-border-soft)' }}>{k}</div>
          ))}
        </Card>

        <Card icon={<Database size={16} />} title="MCP endpoint">
          <div className="text-sm mono" style={{ color: 'var(--color-text-muted)' }}>http://127.0.0.1:7700/mcp</div>
          <div className="text-xs mt-2" style={{ color: 'var(--color-text-subtle)' }}>
            Embedded server. Point any MCP client (bettersync, Claude Code, your scripts) at this URL.
          </div>
        </Card>

        <AICard />
      </div>
    </div>
  )
}

function AICard() {
  const [cfg, setCfg]   = useState<AIConfig>(() => loadAIConfig())
  const [saved, setSaved] = useState(false)

  function save() {
    saveAIConfig(cfg)
    setSaved(true)
    setTimeout(() => setSaved(false), 1400)
  }

  function preset(name: 'openai' | 'groq' | 'ollama' | 'lmstudio') {
    if (name === 'openai')   setCfg((c) => ({ ...c, endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }))
    if (name === 'groq')     setCfg((c) => ({ ...c, endpoint: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' }))
    if (name === 'ollama')   setCfg((c) => ({ ...c, endpoint: 'http://localhost:11434/v1', model: 'qwen2.5:7b', apiKey: 'ollama' }))
    if (name === 'lmstudio') setCfg((c) => ({ ...c, endpoint: 'http://localhost:1234/v1', model: 'local-model', apiKey: 'lm-studio' }))
  }

  return (
    <section className="rounded-lg p-5"
             style={{ background: 'var(--color-bg-soft)', border: '1px solid var(--color-border)' }}>
      <div className="flex items-center gap-2 mb-3 font-semibold text-sm">
        <Sparkles size={16} />
        AI · bring your own LLM
      </div>
      <div className="text-xs mb-4" style={{ color: 'var(--color-text-subtle)' }}>
        Any OpenAI-compatible endpoint works: OpenAI, Groq, OpenRouter, Ollama, LM Studio,
        vLLM, llama.cpp. Your key stays in this device's localStorage — never sent anywhere
        except your chosen endpoint.
      </div>

      <div className="flex gap-2 mb-4">
        {(['openai', 'groq', 'ollama', 'lmstudio'] as const).map((p) => (
          <button
            key={p}
            onClick={() => preset(p)}
            className="text-[11px] px-2 py-1 rounded font-medium hover:bg-[var(--color-border-soft)]"
            style={{
              background: 'var(--color-bg-strong)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
            }}
          >
            {p === 'openai' ? 'OpenAI' : p === 'groq' ? 'Groq' : p === 'ollama' ? 'Ollama' : 'LM Studio'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-3 items-center text-sm">
        <label className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Endpoint</label>
        <input
          value={cfg.endpoint}
          onChange={(e) => setCfg({ ...cfg, endpoint: e.target.value })}
          placeholder="https://api.openai.com/v1"
          className="px-3 py-1.5 mono text-xs outline-none"
          style={{
            background: 'var(--color-bg-strong)',
            border: '1px solid var(--color-border)',
            borderRadius: '0.33em',
            color: 'var(--color-text)',
          }}
        />

        <label className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Model</label>
        <input
          value={cfg.model}
          onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
          placeholder="gpt-4o-mini"
          className="px-3 py-1.5 mono text-xs outline-none"
          style={{
            background: 'var(--color-bg-strong)',
            border: '1px solid var(--color-border)',
            borderRadius: '0.33em',
            color: 'var(--color-text)',
          }}
        />

        <label className="text-xs" style={{ color: 'var(--color-text-muted)' }}>API key</label>
        <input
          type="password"
          value={cfg.apiKey ?? ''}
          onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
          placeholder="sk-… (optional for local servers)"
          className="px-3 py-1.5 mono text-xs outline-none"
          style={{
            background: 'var(--color-bg-strong)',
            border: '1px solid var(--color-border)',
            borderRadius: '0.33em',
            color: 'var(--color-text)',
          }}
        />

        <label className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Temperature</label>
        <input
          type="number"
          step={0.1} min={0} max={2}
          value={cfg.temperature ?? 0.7}
          onChange={(e) => setCfg({ ...cfg, temperature: parseFloat(e.target.value) })}
          className="px-3 py-1.5 mono text-xs outline-none w-24"
          style={{
            background: 'var(--color-bg-strong)',
            border: '1px solid var(--color-border)',
            borderRadius: '0.33em',
            color: 'var(--color-text)',
          }}
        />
      </div>

      <div className="mt-4 flex justify-end items-center gap-2">
        {saved && (
          <span className="text-xs" style={{ color: 'var(--color-success)' }}>✓ Saved</span>
        )}
        <button
          onClick={save}
          className="px-3 py-1.5 text-sm font-medium text-white"
          style={{
            background: 'var(--color-accent)',
            borderRadius: '0.33em',
          }}
        >
          Save
        </button>
      </div>
    </section>
  )
}

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg p-5" style={{ background: 'var(--color-bg-soft)', border: '1px solid var(--color-border)' }}>
      <div className="flex items-center gap-2 mb-3 font-semibold text-sm">{icon}{title}</div>
      {children}
    </section>
  )
}
function Empty({ msg }: { msg: string }) {
  return <div className="text-sm py-2" style={{ color: 'var(--color-text-subtle)' }}>{msg}</div>
}
