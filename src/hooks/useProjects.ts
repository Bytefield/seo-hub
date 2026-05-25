import { useState, useCallback } from 'react'
import { useAppStore } from '../store/appStore'
import { getProjects, createProject, updateProject, deleteProject } from '../lib/tauri'
import type { Project } from '../lib/tauri'

export function useProjects() {
  const { projects, setProjects, setLoading } = useAppStore()
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading('projects', true)
    try {
      setProjects(await getProjects())
      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading('projects', false)
    }
  }, [setProjects, setLoading])

  const create = useCallback(async (payload: Parameters<typeof createProject>[0]) => {
    const project = await createProject(payload)
    setProjects([project, ...projects])
    return project
  }, [projects, setProjects])

  const update = useCallback(async (id: number, payload: Parameters<typeof updateProject>[1]) => {
    const updated = await updateProject(id, payload)
    setProjects(projects.map(p => p.id === id ? updated : p))
    return updated
  }, [projects, setProjects])

  const remove = useCallback(async (id: number) => {
    await deleteProject(id)
    setProjects(projects.filter(p => p.id !== id))
  }, [projects, setProjects])

  return { projects, refresh, create, update, remove, error }
}
