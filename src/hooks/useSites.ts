import { useState, useCallback } from 'react'
import { useAppStore } from '../store/appStore'
import { getSites, createSite, updateSite, deleteSite } from '../lib/tauri'

export function useSites(projectId?: number) {
  const { sites, setSites, setLoading } = useAppStore()
  const [error, setError] = useState<string | null>(null)

  const filtered = projectId != null ? sites.filter(s => s.project_id === projectId) : sites

  const refresh = useCallback(async () => {
    setLoading('sites', true)
    try {
      setSites(await getSites(projectId))
      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading('sites', false)
    }
  }, [projectId, setSites, setLoading])

  const create = useCallback(async (payload: Parameters<typeof createSite>[0]) => {
    const site = await createSite(payload)
    setSites([site, ...sites])
    return site
  }, [sites, setSites])

  const update = useCallback(async (id: number, payload: Parameters<typeof updateSite>[1]) => {
    await updateSite(id, payload)
    await refresh()
  }, [refresh])

  const remove = useCallback(async (id: number) => {
    await deleteSite(id)
    setSites(sites.filter(s => s.id !== id))
  }, [sites, setSites])

  return { sites: filtered, refresh, create, update, remove, error }
}
