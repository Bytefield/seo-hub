import { create } from 'zustand'
import type { Project, Site, CredentialStatus, User } from '../lib/tauri'

interface AppStore {
  // Auth
  isUnlocked: boolean
  user: User | null
  setUnlocked: (v: boolean) => void
  setUser: (u: User | null) => void

  // Active project/site selection
  activeProjectId: number | null
  activeSiteId: number | null
  setActiveProject: (id: number | null) => void
  setActiveSite: (id: number | null) => void

  // Data
  projects: Project[]
  sites: Site[]
  credentials: CredentialStatus[]
  setProjects: (p: Project[]) => void
  setSites: (s: Site[]) => void
  setCredentials: (c: CredentialStatus[]) => void

  // UI state
  sidebarCollapsed: boolean
  activeNav: string
  theme: 'dark' | 'light'
  setSidebarCollapsed: (v: boolean) => void
  setActiveNav: (v: string) => void
  setTheme: (t: 'dark' | 'light') => void

  // Loading states
  loading: Record<string, boolean>
  setLoading: (key: string, v: boolean) => void
}

export const useAppStore = create<AppStore>((set) => ({
  isUnlocked: false,
  user: null,
  setUnlocked: (isUnlocked) => set({ isUnlocked }),
  setUser: (user) => set({ user }),

  activeProjectId: null,
  activeSiteId: null,
  setActiveProject: (activeProjectId) => set({ activeProjectId, activeSiteId: null }),
  setActiveSite: (activeSiteId) => set({ activeSiteId }),

  projects: [],
  sites: [],
  credentials: [],
  setProjects: (projects) => set({ projects }),
  setSites: (sites) => set({ sites }),
  setCredentials: (credentials) => set({ credentials }),

  sidebarCollapsed: false,
  activeNav: 'dashboard',
  theme: (localStorage.getItem('seohub-theme') as 'dark' | 'light') ?? 'dark',
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setActiveNav: (activeNav) => set({ activeNav }),
  setTheme: (theme) => {
    localStorage.setItem('seohub-theme', theme)
    document.documentElement.classList.toggle('light', theme === 'light')
    set({ theme })
  },

  loading: {},
  setLoading: (key, v) => set((s) => ({ loading: { ...s.loading, [key]: v } })),
}))
