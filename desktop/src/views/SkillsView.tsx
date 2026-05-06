import { useEffect, useState } from 'react'
import { Plus, Sparkles } from '../lib/icons'
import { k, type Skill } from '../lib/mcp'
import { store } from '../store'
import { appPrompt } from '../lib/dialog'

export function SkillsListView() {
  const [own, setOwn] = useState<Skill[]>([])
  const [installed, setInstalled] = useState<Skill[]>([])
  const [refresh, setRefresh] = useState(0)
  useEffect(() => { k.listSkills().then((r) => { setOwn(r.own); setInstalled(r.installed) }) }, [refresh])
  return (
    <div className="h-full overflow-auto px-8 py-8" style={{ background: 'var(--color-bg-strong)' }}>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center mb-6">
          <Sparkles size={24} className="mr-2" />
          <h1 className="text-2xl font-bold flex-1">Skills</h1>
          <button
            onClick={async () => {
              const name = await appPrompt('Skill name (kebab-case)?'); if (!name) return
              const created = await k.createSkill({ name, displayName: name, description: '', skillMd: `# ${name}\n\nWrite the skill here.\n` })
              setRefresh((n) => n + 1)
              store.open({ title: created.displayName ?? created.name, icon: '✨', view: { kind: 'skill', skillId: created.id } })
            }}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md font-medium text-white"
            style={{ background: 'var(--color-accent)' }}
          ><Plus size={14} /> New skill</button>
        </div>

        <SectionTitle>Own ({own.length})</SectionTitle>
        <div className="grid md:grid-cols-2 gap-3 mb-8">
          {own.map((s) => <Card key={s.id} skill={s} />)}
          {own.length === 0 && <Empty msg="No skills yet." />}
        </div>

        <SectionTitle>Installed ({installed.length})</SectionTitle>
        <div className="grid md:grid-cols-2 gap-3">
          {installed.map((s) => <Card key={s.id} skill={s} />)}
          {installed.length === 0 && <Empty msg="No installed skills. Browse the marketplace to add some." />}
        </div>
      </div>
    </div>
  )
}

function Card({ skill }: { skill: Skill }) {
  return (
    <button
      onClick={() => store.open({ title: skill.displayName ?? skill.name, icon: '✨', view: { kind: 'skill', skillId: skill.id } })}
      className="text-left rounded-lg p-4 hover:shadow-md transition-shadow"
      style={{ background: 'var(--color-bg-soft)', border: '1px solid var(--color-border)' }}
    >
      <div className="font-semibold">{skill.displayName ?? skill.name}</div>
      {skill.description && <div className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>{skill.description.slice(0, 120)}</div>}
    </button>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] uppercase tracking-wider font-semibold mb-2" style={{ color: 'var(--color-text-subtle)' }}>{children}</div>
}
function Empty({ msg }: { msg: string }) {
  return <div className="col-span-full text-sm py-6" style={{ color: 'var(--color-text-subtle)' }}>{msg}</div>
}

export function SkillView({ skillId }: { skillId: string }) {
  // Skills are essentially: a name + a SKILL.md body. Edit and save.
  const [own, setOwn] = useState<Skill[]>([])
  useEffect(() => { k.listSkills().then((r) => setOwn([...r.own, ...r.installed])) }, [skillId])
  const skill = own.find((s) => s.id === skillId)
  const [body, setBody] = useState('')
  useEffect(() => { setBody(skill?.skillMd ?? '') }, [skill?.id])

  if (!skill) return <div className="p-8" style={{ color: 'var(--color-text-subtle)' }}>Loading…</div>

  return (
    <div className="h-full overflow-auto px-8 py-8" style={{ background: 'var(--color-bg-strong)' }}>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-baseline gap-3 mb-2">
          <span className="text-3xl">✨</span>
          <input
            defaultValue={skill.displayName ?? skill.name}
            onBlur={(e) => k.updateSkill(skill.id, { displayName: e.target.value })}
            className="flex-1 text-3xl font-bold bg-transparent border-none outline-none"
          />
        </div>
        <input
          defaultValue={skill.description ?? ''}
          onBlur={(e) => k.updateSkill(skill.id, { description: e.target.value })}
          placeholder="Short description"
          className="w-full bg-transparent border-none outline-none text-sm mb-6"
          style={{ color: 'var(--color-text-muted)' }}
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onBlur={() => k.updateSkill(skill.id, { skillMd: body })}
          className="w-full bg-transparent border rounded-md p-3 outline-none focus:border-[var(--color-accent)] mono text-sm"
          style={{ borderColor: 'var(--color-border)', minHeight: '60vh' }}
        />
      </div>
    </div>
  )
}
