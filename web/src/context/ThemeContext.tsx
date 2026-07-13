import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { applyThemeCssVars, clearThemeCssVars } from '../lib/theme/applyThemeCssVars'
import { clearSchemeCache, resolveSchemeCssVars } from '../lib/theme/schemeLoader'
import {
  getThemeSet,
  PERTISK_DEFAULT_THEME_SET_ID,
  schemeRefForThemeSet,
  THEME_SETS,
  type ThemeSetDefinition,
} from '../lib/theme/themeSets'

const LEGACY_THEME_KEY = 'pertisk_gits_theme'
const PREFS_KEY = 'pertisk_gits_theme_prefs'

export type ThemeMode = 'light' | 'dark'

export interface ImportedScheme {
  name: string
  content: string
}

export interface ThemePreferences {
  mode: ThemeMode
  themeSetId: string
  importedSchemes: Record<string, ImportedScheme>
}

type ThemeContextValue = {
  theme: ThemeMode
  isDark: boolean
  themeSetId: string
  themeSets: ThemeSetDefinition[]
  activeThemeSet: ThemeSetDefinition
  importedSchemes: Record<string, ImportedScheme>
  loadingTheme: boolean
  themeError: string | null
  setTheme: (mode: ThemeMode) => void
  toggleTheme: () => void
  setThemeSetId: (id: string) => void
  importItermScheme: (file: File) => Promise<string>
  removeImportedScheme: (schemeId: string) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function defaultPreferences(): ThemePreferences {
  return {
    mode: 'dark',
    themeSetId: PERTISK_DEFAULT_THEME_SET_ID,
    importedSchemes: {},
  }
}

function readPreferences(): ThemePreferences {
  if (typeof localStorage === 'undefined') return defaultPreferences()

  const raw = localStorage.getItem(PREFS_KEY)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<ThemePreferences>
      return {
        mode: parsed.mode === 'light' ? 'light' : 'dark',
        themeSetId: parsed.themeSetId ?? PERTISK_DEFAULT_THEME_SET_ID,
        importedSchemes: parsed.importedSchemes ?? {},
      }
    } catch {
      return defaultPreferences()
    }
  }

  const legacy = localStorage.getItem(LEGACY_THEME_KEY)
  if (legacy === 'light' || legacy === 'dark') {
    return { ...defaultPreferences(), mode: legacy }
  }
  return defaultPreferences()
}

function writePreferences(prefs: ThemePreferences): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  localStorage.setItem(LEGACY_THEME_KEY, prefs.mode)
}

function applyModeClass(mode: ThemeMode): void {
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add(mode)
  root.dataset.themeMode = mode
}

function importedSchemeId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `imported:${slug || 'scheme'}`
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<ThemePreferences>(() => {
    const initial = readPreferences()
    applyModeClass(initial.mode)
    document.documentElement.dataset.themeSet = initial.themeSetId
    return initial
  })
  const [loadingTheme, setLoadingTheme] = useState(false)
  const [themeError, setThemeError] = useState<string | null>(null)
  const loadGeneration = useRef(0)

  const importedThemeSets = useMemo<ThemeSetDefinition[]>(() => {
    return Object.entries(prefs.importedSchemes).map(([id, scheme]) => ({
      id,
      name: scheme.name,
      description: 'Imported iTerm2 color scheme',
      dark: { id, name: scheme.name, file: '' },
      light: { id, name: scheme.name, file: '' },
    }))
  }, [prefs.importedSchemes])

  const themeSets = useMemo(
    () => [...THEME_SETS, ...importedThemeSets],
    [importedThemeSets],
  )

  const activeThemeSet = useMemo(
    () => themeSets.find((set) => set.id === prefs.themeSetId) ?? getThemeSet(PERTISK_DEFAULT_THEME_SET_ID)!,
    [prefs.themeSetId, themeSets],
  )

  // Mode toggles apply instantly — no async theme fetch.
  useEffect(() => {
    applyModeClass(prefs.mode)
  }, [prefs.mode])

  useEffect(() => {
    writePreferences(prefs)
  }, [prefs])

  useEffect(() => {
    document.documentElement.dataset.themeSet = prefs.themeSetId

    const themeSet =
      themeSets.find((set) => set.id === prefs.themeSetId) ??
      getThemeSet(PERTISK_DEFAULT_THEME_SET_ID)!

    if (themeSet.builtin) {
      clearThemeCssVars()
      setThemeError(null)
      setLoadingTheme(false)
      return
    }

    const generation = ++loadGeneration.current
    const darkRef = schemeRefForThemeSet(themeSet, 'dark')
    const lightRef = schemeRefForThemeSet(themeSet, 'light')

    if (!darkRef && !lightRef) {
      clearThemeCssVars()
      setThemeError('This theme set has no schemes.')
      setLoadingTheme(false)
      return
    }

    setLoadingTheme(true)
    setThemeError(null)

    void (async () => {
      try {
        const [darkVars, lightVars] = await Promise.all([
          darkRef
            ? resolveSchemeCssVars(darkRef, 'dark', prefs.importedSchemes)
            : Promise.resolve(undefined),
          lightRef
            ? resolveSchemeCssVars(lightRef, 'light', prefs.importedSchemes)
            : Promise.resolve(undefined),
        ])

        if (generation !== loadGeneration.current) return

        applyThemeCssVars(prefs.themeSetId, {
          dark: darkVars,
          light: lightVars,
        })
        setThemeError(null)
      } catch (err) {
        if (generation !== loadGeneration.current) return
        clearSchemeCache()
        clearThemeCssVars()
        setThemeError((err as Error).message)
      } finally {
        if (generation === loadGeneration.current) {
          setLoadingTheme(false)
        }
      }
    })()
  }, [prefs.themeSetId, prefs.importedSchemes, themeSets])

  const setTheme = useCallback((mode: ThemeMode) => {
    setPrefs((current) => ({ ...current, mode }))
  }, [])

  const toggleTheme = useCallback(() => {
    setPrefs((current) => ({ ...current, mode: current.mode === 'dark' ? 'light' : 'dark' }))
  }, [])

  const setThemeSetId = useCallback((themeSetId: string) => {
    setPrefs((current) => ({ ...current, themeSetId }))
  }, [])

  const importItermScheme = useCallback(async (file: File) => {
    const content = await file.text()
    const schemeId = importedSchemeId(file.name)
    setPrefs((current) => ({
      ...current,
      themeSetId: schemeId,
      importedSchemes: {
        ...current.importedSchemes,
        [schemeId]: { name: file.name.replace(/\.itermcolors$/i, ''), content },
      },
    }))
    return schemeId
  }, [])

  const removeImportedScheme = useCallback((schemeId: string) => {
    setPrefs((current) => {
      const nextImported = { ...current.importedSchemes }
      delete nextImported[schemeId]
      return {
        ...current,
        themeSetId:
          current.themeSetId === schemeId ? PERTISK_DEFAULT_THEME_SET_ID : current.themeSetId,
        importedSchemes: nextImported,
      }
    })
  }, [])

  return (
    <ThemeContext.Provider
      value={{
        theme: prefs.mode,
        isDark: prefs.mode === 'dark',
        themeSetId: prefs.themeSetId,
        themeSets,
        activeThemeSet,
        importedSchemes: prefs.importedSchemes,
        loadingTheme,
        themeError,
        setTheme,
        toggleTheme,
        setThemeSetId,
        importItermScheme,
        removeImportedScheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
