import { create } from 'zustand';
import type { Literature, Project, Settings } from '../types';

interface AppState {
  // Navigation
  currentProjectId: string | null;
  setCurrentProjectId: (id: string | null) => void;

  // Settings
  settings: Settings;
  setSettings: (settings: Settings) => void;

  // Sidebar
  sidebarOpen: boolean;
  toggleSidebar: () => void;

  // Comparison selection
  comparisonDois: string[];
  toggleComparisonDoi: (doi: string) => void;
  clearComparison: () => void;

  // Search results cache (transient)
  searchResults: Literature[];
  searchWarning: string | null;
  setSearchResults: (results: Literature[], warning?: string | null) => void;

  // Onboarding
  needsOnboarding: boolean;
  setNeedsOnboarding: (v: boolean) => void;

  // Selected literature for detail view
  selectedDoi: string | null;
  setSelectedDoi: (doi: string | null) => void;

  // Projects
  projects: Project[];
  setProjects: (projects: Project[]) => void;

  // Inbox
  inboxItems: Literature[];
  setInboxItems: (items: Literature[]) => void;

  // Chat
  activeChatSessionId: string | null;
  setActiveChatSessionId: (id: string | null) => void;
  chatContextDois: string[];
  setChatContextDois: (dois: string[]) => void;

  // Toast
  toast: { message: string; type: 'info' | 'error' | 'success' } | null;
  showToast: (message: string, type?: 'info' | 'error' | 'success') => void;
  clearToast: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentProjectId: null,
  setCurrentProjectId: (id) => set({ currentProjectId: id }),

  settings: {
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
  },
  setSettings: (settings) => set({ settings }),

  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  comparisonDois: [],
  toggleComparisonDoi: (doi) =>
    set((s) => ({
      comparisonDois: s.comparisonDois.includes(doi)
        ? s.comparisonDois.filter((d) => d !== doi)
        : [...s.comparisonDois, doi],
    })),
  clearComparison: () => set({ comparisonDois: [] }),

  searchResults: [],
  searchWarning: null,
  setSearchResults: (results, warning = null) =>
    set({ searchResults: results, searchWarning: warning }),

  needsOnboarding: true,
  setNeedsOnboarding: (v) => set({ needsOnboarding: v }),

  selectedDoi: null,
  setSelectedDoi: (doi) => set({ selectedDoi: doi }),

  projects: [],
  setProjects: (projects) => set({ projects }),

  inboxItems: [],
  setInboxItems: (items) => set({ inboxItems: items }),

  activeChatSessionId: null,
  setActiveChatSessionId: (id) => set({ activeChatSessionId: id }),
  chatContextDois: [],
  setChatContextDois: (dois) => set({ chatContextDois: dois }),

  toast: null,
  showToast: (message, type = 'info') => {
    set({ toast: { message, type } });
    setTimeout(() => set({ toast: null }), 3500);
  },
  clearToast: () => set({ toast: null }),
}));
