import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Settings, Key, Globe, Database } from 'lucide-react'
import { call } from '../lib/mcp'

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
      </div>
    </div>
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
