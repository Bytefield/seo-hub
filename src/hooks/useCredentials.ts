import { useState, useCallback } from 'react'
import { useAppStore } from '../store/appStore'
import { getAllCredentialStatuses, saveCredential, deleteCredential, testCredential } from '../lib/tauri'
import type { TestResult } from '../lib/tauri'

export function useCredentials() {
  const { credentials, setCredentials, setLoading } = useAppStore()
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading('credentials', true)
    try {
      setCredentials(await getAllCredentialStatuses())
      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading('credentials', false)
    }
  }, [setCredentials, setLoading])

  const save = useCallback(async (payload: Parameters<typeof saveCredential>[0]) => {
    const updated = await saveCredential(payload)
    setCredentials(credentials.map(c => c.service === updated.service ? updated : c))
    return updated
  }, [credentials, setCredentials])

  const remove = useCallback(async (service: string) => {
    await deleteCredential(service)
    await refresh()
  }, [refresh])

  const test = useCallback(async (service: string): Promise<TestResult> => {
    return testCredential(service)
  }, [])

  return { credentials, refresh, save, remove, test, error }
}
