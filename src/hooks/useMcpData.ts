import { useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'

export type McpSource = 'gsc' | 'bwt' | 'ga4' | 'clarity' | 'psi'

interface McpState {
  data: Record<McpSource, unknown>
  loading: Record<McpSource, boolean>
  error: Record<McpSource, string | null>
}

const SOURCES: McpSource[] = ['gsc', 'bwt', 'ga4', 'clarity', 'psi']

function emptyRecord<T>(val: T): Record<McpSource, T> {
  return Object.fromEntries(SOURCES.map(s => [s, val])) as Record<McpSource, T>
}

export function useMcpData(siteId: number | null) {
  const [state, setState] = useState<McpState>({
    data: emptyRecord(null),
    loading: emptyRecord(false),
    error: emptyRecord(null),
  })

  const fetchSource = useCallback(async (source: McpSource) => {
    if (!siteId) return
    setState(s => ({
      ...s,
      loading: { ...s.loading, [source]: true },
      error: { ...s.error, [source]: null },
    }))
    try {
      const data = await invoke('fetch_mcp_data', { source, siteId, params: null })
      setState(s => ({
        ...s,
        data: { ...s.data, [source]: data },
        loading: { ...s.loading, [source]: false },
      }))
    } catch (e) {
      setState(s => ({
        ...s,
        loading: { ...s.loading, [source]: false },
        error: { ...s.error, [source]: String(e) },
      }))
    }
  }, [siteId])

  return { ...state, fetchSource }
}
