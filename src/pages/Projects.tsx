import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Globe, ChevronRight } from 'lucide-react'
import { getProjects, createProject, updateProject, deleteProject } from '../lib/tauri'
import type { Project } from '../lib/tauri'
import { useAppStore } from '../store/appStore'
import clsx from 'clsx'

const ICONS = ['🌐','🏠','🏪','🏗','🏢','📊','🚀','⚡','🎯','💡','🔧','📱']
const COLORS = ['#f97316','#38bdf8','#10d9a0','#a78bfa','#f43f5e','#f59e0b','#60a5fa','#34d399']

function Modal({ project, onClose, onSave }: {
  project?: Project | null
  onClose: () => void
  onSave: () => void
}) {
  const [name, setName] = useState(project?.name ?? '')
  const [desc, setDesc] = useState(project?.description ?? '')
  const [color, setColor] = useState(project?.color ?? '#f97316')
  const [icon, setIcon] = useState(project?.icon ?? '🌐')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true)
    try {
      if (project) {
        await updateProject(project.id, { name, description: desc, color, icon })
      } else {
        await createProject({ name, description: desc, color, icon })
      }
      onSave()
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(6,8,11,0.85)', backdropFilter: 'blur(8px)' }}>
      <div className="anim-up w-full max-w-md rounded-[var(--rl)] border overflow-hidden"
        style={{ background: 'var(--s1)', borderColor: 'var(--b2)' }}>

        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between"
          style={{ borderColor: 'var(--b1)' }}>
          <div>
            <div className="font-display text-[17px] text-[var(--t1)]">
              {project ? 'Edit Project' : 'New Project'}
            </div>
            <div className="font-mono text-[11px] text-[var(--t3)] mt-0.5">
              {project ? `ID #${project.id}` : 'Configure a new project'}
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--t3)] hover:text-[var(--t1)] transition-colors text-lg">×</button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-5">
          {/* Preview */}
          <div className="flex items-center gap-3 p-3 rounded-[var(--r)] border"
            style={{ background: 'var(--s2)', borderColor: 'var(--b1)' }}>
            <div className="w-10 h-10 rounded-[var(--r)] flex items-center justify-center text-xl flex-shrink-0"
              style={{ background: color + '22', border: `1px solid ${color}44` }}>
              {icon}
            </div>
            <div>
              <div className="font-medium text-[17px] text-[var(--t1)]">{name || 'Project Name'}</div>
              <div className="font-mono text-[11px] text-[var(--t3)]">{desc || 'Description'}</div>
            </div>
          </div>

          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[11px] tracking-wider uppercase text-[var(--t3)]">
              Name <span className="text-[var(--accent)]">*</span>
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. MercadoHipotecas"
              className="px-3 py-2 rounded-[var(--r)] border outline-none font-mono text-[13px] transition-colors"
              style={{ background: 'var(--bg2)', borderColor: name ? 'var(--accent)' : 'var(--b2)', color: 'var(--t1)' }}
            />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[11px] tracking-wider uppercase text-[var(--t3)]">Description</label>
            <input
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="Optional notes"
              className="px-3 py-2 rounded-[var(--r)] border outline-none font-mono text-[13px] transition-colors"
              style={{ background: 'var(--bg2)', borderColor: 'var(--b2)', color: 'var(--t1)' }}
            />
          </div>

          {/* Icon */}
          <div className="flex flex-col gap-2">
            <label className="font-mono text-[11px] tracking-wider uppercase text-[var(--t3)]">Icon</label>
            <div className="flex flex-wrap gap-2">
              {ICONS.map(ic => (
                <button key={ic} onClick={() => setIcon(ic)}
                  className="w-9 h-9 rounded-[var(--r)] text-lg flex items-center justify-center border transition-all"
                  style={{
                    background: icon === ic ? 'var(--adim)' : 'var(--s2)',
                    borderColor: icon === ic ? 'var(--accent)' : 'var(--b1)',
                  }}>
                  {ic}
                </button>
              ))}
            </div>
          </div>

          {/* Color */}
          <div className="flex flex-col gap-2">
            <label className="font-mono text-[11px] tracking-wider uppercase text-[var(--t3)]">Color</label>
            <div className="flex gap-2">
              {COLORS.map(c => (
                <button key={c} onClick={() => setColor(c)}
                  className="w-7 h-7 rounded-full border-2 transition-all"
                  style={{ background: c, borderColor: color === c ? 'white' : 'transparent', transform: color === c ? 'scale(1.2)' : 'scale(1)' }} />
              ))}
            </div>
          </div>

          {error && <div className="font-mono text-[12px] text-[var(--red)]">{error}</div>}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button onClick={onClose}
              className="flex-1 py-2 rounded-[var(--r)] border font-mono text-[12px] text-[var(--t2)] transition-all hover:border-[var(--b3)]"
              style={{ background: 'transparent', borderColor: 'var(--b2)' }}>
              Cancel
            </button>
            <button onClick={handleSubmit} disabled={saving}
              className="flex-1 py-2 rounded-[var(--r)] font-mono text-[12px] text-white font-medium transition-all hover:opacity-90"
              style={{ background: saving ? 'var(--b2)' : 'var(--accent)' }}>
              {saving ? 'Saving…' : project ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Projects() {
  const { projects, setProjects, setActiveProject, setActiveNav, sites } = useAppStore()
  const [modal, setModal] = useState<{ open: boolean; project?: Project | null }>({ open: false })
  const [deleting, setDeleting] = useState<number | null>(null)

  async function load() {
    const data = await getProjects()
    setProjects(data)
  }

  useEffect(() => { load() }, [])

  async function handleDelete(id: number) {
    setDeleting(id)
    try {
      await deleteProject(id)
      await load()
    } finally {
      setDeleting(null)
    }
  }

  function openDashboard(project: Project) {
    setActiveProject(project.id)
    setActiveNav('dashboard')
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Header */}
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl text-[var(--t1)]">
            Your <span className="text-[var(--accent)]">Projects</span>
          </h1>
          <p className="font-mono text-[12px] text-[var(--t3)] mt-1">
            {projects.length} project{projects.length !== 1 ? 's' : ''} · {sites.length} sites tracked
          </p>
        </div>
        <button
          onClick={() => setModal({ open: true, project: null })}
          className="flex items-center gap-2 px-4 py-2 rounded-[var(--r)] font-mono text-[12px] text-white font-medium transition-all hover:opacity-90"
          style={{ background: 'var(--accent)' }}>
          <Plus size={13} /> New Project
        </button>
      </div>

      {/* Empty state */}
      {projects.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 gap-4 anim-up">
          <div className="w-16 h-16 rounded-full flex items-center justify-center border"
            style={{ background: 'var(--s2)', borderColor: 'var(--b1)' }}>
            <Globe size={28} className="text-[var(--t3)]" />
          </div>
          <div className="text-center">
            <div className="font-display text-[17px] text-[var(--t2)]">No projects yet</div>
            <div className="font-mono text-[12px] text-[var(--t3)] mt-1">Create your first project to start tracking sites</div>
          </div>
          <button onClick={() => setModal({ open: true, project: null })}
            className="px-4 py-2 rounded-[var(--r)] font-mono text-[12px] border transition-all hover:border-[var(--accent)] hover:text-[var(--accent)]"
            style={{ borderColor: 'var(--b2)', color: 'var(--t3)' }}>
            + Create project
          </button>
        </div>
      )}

      {/* Project grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {projects.map((p, i) => (
          <div key={p.id}
            className={clsx('group relative rounded-[var(--rl)] border transition-all duration-200 hover:border-opacity-60 anim-up', `anim-d${Math.min(i + 1, 6)}`)}
            style={{ background: 'var(--s1)', borderColor: 'var(--b1)' }}>

            {/* Top accent bar */}
            <div className="absolute top-0 left-0 right-0 h-px rounded-t-[var(--rl)]"
              style={{ background: p.color }} />

            <div className="p-5">
              {/* Icon + name */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-[var(--r)] flex items-center justify-center text-xl flex-shrink-0"
                    style={{ background: p.color + '18', border: `1px solid ${p.color}33` }}>
                    {p.icon}
                  </div>
                  <div>
                    <div className="font-medium text-[17px] text-[var(--t1)]">{p.name}</div>
                    {p.description && (
                      <div className="font-mono text-[11px] text-[var(--t3)] mt-0.5 line-clamp-1">{p.description}</div>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => setModal({ open: true, project: p })}
                    className="w-7 h-7 flex items-center justify-center rounded-[var(--r)] border transition-all hover:border-[var(--accent)] hover:text-[var(--accent)]"
                    style={{ borderColor: 'var(--b1)', color: 'var(--t3)' }}>
                    <Pencil size={11} />
                  </button>
                  <button onClick={() => handleDelete(p.id)} disabled={deleting === p.id}
                    className="w-7 h-7 flex items-center justify-center rounded-[var(--r)] border transition-all hover:border-[var(--red)] hover:text-[var(--red)]"
                    style={{ borderColor: 'var(--b1)', color: 'var(--t3)' }}>
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 p-2.5 rounded-[var(--r)] border text-center"
                  style={{ background: 'var(--s2)', borderColor: 'var(--b1)' }}>
                  <div className="font-mono text-[18px] font-bold text-[var(--t1)]">{p.site_count}</div>
                  <div className="font-mono text-[10px] text-[var(--t3)] uppercase tracking-wide">Sites</div>
                </div>
                <div className="flex-1 p-2.5 rounded-[var(--r)] border text-center"
                  style={{ background: 'var(--s2)', borderColor: 'var(--b1)' }}>
                  <div className="font-mono text-[18px] font-bold" style={{ color: p.color }}>—</div>
                  <div className="font-mono text-[10px] text-[var(--t3)] uppercase tracking-wide">Score</div>
                </div>
              </div>

              {/* Open dashboard */}
              <button onClick={() => openDashboard(p)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-[var(--r)] border font-mono text-[12px] transition-all hover:text-[var(--t1)]"
                style={{ background: 'var(--s2)', borderColor: 'var(--b1)', color: 'var(--t2)' }}>
                <span>Open Dashboard</span>
                <ChevronRight size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {modal.open && (
        <Modal
          project={modal.project}
          onClose={() => setModal({ open: false })}
          onSave={load}
        />
      )}
    </div>
  )
}
