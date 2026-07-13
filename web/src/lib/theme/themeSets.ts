export const ITERM_SCHEMES_BASE_URL = '/themes'
/** Fallback when bundled themes are unavailable (dev without public/themes sync). */
export const ITERM_SCHEMES_REMOTE_URL =
  'https://raw.githubusercontent.com/mbadolato/iTerm2-Color-Schemes/master/schemes'
/** GitHub folder for browsing additional schemes to import. */
export const ITERM_SCHEMES_REPO_URL =
  'https://github.com/mbadolato/iTerm2-Color-Schemes/tree/master/schemes'

export const PERTISK_DEFAULT_THEME_SET_ID = 'pertisk-default'

export interface ThemeSchemeRef {
  id: string
  name: string
  file: string
}

export interface ThemeSetDefinition {
  id: string
  name: string
  description: string
  dark?: ThemeSchemeRef
  light?: ThemeSchemeRef
  builtin?: boolean
}

/** Curated iTerm2 schemes — full catalog: https://github.com/mbadolato/iTerm2-Color-Schemes/tree/master/schemes */
export const ITERM_SCHEME_CATALOG: ThemeSchemeRef[] = [
  { id: 'dracula', name: 'Dracula', file: 'Dracula.itermcolors' },
  { id: 'nord', name: 'Nord', file: 'Nord.itermcolors' },
  { id: 'gruvbox-dark', name: 'Gruvbox Dark', file: 'Gruvbox Dark.itermcolors' },
  { id: 'gruvbox-light', name: 'Gruvbox Light', file: 'Gruvbox Light.itermcolors' },
  { id: 'atom-one-dark', name: 'Atom One Dark', file: 'Atom One Dark.itermcolors' },
  { id: 'atom-one-light', name: 'Atom One Light', file: 'Atom One Light.itermcolors' },
  { id: 'github-dark', name: 'GitHub Dark', file: 'GitHub Dark.itermcolors' },
  { id: 'github-light', name: 'GitHub Light', file: 'GitHub Light Default.itermcolors' },
  { id: 'catppuccin-mocha', name: 'Catppuccin Mocha', file: 'Catppuccin Mocha.itermcolors' },
  { id: 'catppuccin-latte', name: 'Catppuccin Latte', file: 'Catppuccin Latte.itermcolors' },
  { id: 'solarized-dark', name: 'Solarized Dark', file: 'iTerm2 Solarized Dark.itermcolors' },
  { id: 'solarized-light', name: 'Solarized Light', file: 'iTerm2 Solarized Light.itermcolors' },
  { id: 'tokyo-night', name: 'Tokyo Night', file: 'TokyoNight.itermcolors' },
  { id: 'tokyo-night-day', name: 'Tokyo Night Day', file: 'TokyoNight Day.itermcolors' },
  { id: 'one-half-dark', name: 'One Half Dark', file: 'One Half Dark.itermcolors' },
  { id: 'one-half-light', name: 'One Half Light', file: 'One Half Light.itermcolors' },
  { id: 'monokai', name: 'Monokai Classic', file: 'Monokai Classic.itermcolors' },
  { id: 'ayu-mirage', name: 'Ayu Mirage', file: 'Ayu Mirage.itermcolors' },
  { id: 'ayu-light', name: 'Ayu Light', file: 'Ayu Light.itermcolors' },
  { id: 'night-owl', name: 'Night Owl', file: 'Night Owl.itermcolors' },
  { id: 'night-owl-light', name: 'Night Owl Light', file: 'Light Owl.itermcolors' },
  { id: 'cobalt2', name: 'Cobalt2', file: 'Cobalt2.itermcolors' },
  { id: 'snazzy', name: 'Snazzy', file: 'Snazzy.itermcolors' },
  { id: 'palenight', name: 'Pale Night HC', file: 'Pale Night Hc.itermcolors' },
  { id: 'material', name: 'Material Dark', file: 'Material Dark.itermcolors' },
  { id: 'material-light', name: 'Gruvbox Material Light', file: 'Gruvbox Material Light.itermcolors' },
]

export const THEME_SETS: ThemeSetDefinition[] = [
  {
    id: PERTISK_DEFAULT_THEME_SET_ID,
    name: 'Pertisk (default)',
    description: 'Built-in violet Flux theme.',
    builtin: true,
  },
  {
    id: 'dracula',
    name: 'Dracula',
    description: 'Classic Dracula with Atom One Light.',
    dark: ref('dracula'),
    light: ref('atom-one-light'),
  },
  {
    id: 'nord',
    name: 'Nord',
    description: 'Arctic, bluish Nord palette.',
    dark: ref('nord'),
    light: ref('atom-one-light'),
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin',
    description: 'Pastel Mocha + Latte pair.',
    dark: ref('catppuccin-mocha'),
    light: ref('catppuccin-latte'),
  },
  {
    id: 'atom-one',
    name: 'Atom One',
    description: 'Atom One Dark + Light.',
    dark: ref('atom-one-dark'),
    light: ref('atom-one-light'),
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'GitHub Dark + Light.',
    dark: ref('github-dark'),
    light: ref('github-light'),
  },
  {
    id: 'gruvbox',
    name: 'Gruvbox',
    description: 'Retro Groove dark + light.',
    dark: ref('gruvbox-dark'),
    light: ref('gruvbox-light'),
  },
  {
    id: 'solarized',
    name: 'Solarized',
    description: 'Solarized dark + light.',
    dark: ref('solarized-dark'),
    light: ref('solarized-light'),
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    description: 'Tokyo Night + Day.',
    dark: ref('tokyo-night'),
    light: ref('tokyo-night-day'),
  },
  {
    id: 'one-half',
    name: 'One Half',
    description: 'One Half Dark + Light.',
    dark: ref('one-half-dark'),
    light: ref('one-half-light'),
  },
  {
    id: 'ayu',
    name: 'Ayu',
    description: 'Ayu Mirage + Light.',
    dark: ref('ayu-mirage'),
    light: ref('ayu-light'),
  },
  {
    id: 'night-owl',
    name: 'Night Owl',
    description: 'Night Owl + Light Owl.',
    dark: ref('night-owl'),
    light: ref('night-owl-light'),
  },
  {
    id: 'monokai',
    name: 'Monokai',
    description: 'Monokai Classic with GitHub Light.',
    dark: ref('monokai'),
    light: ref('github-light'),
  },
  {
    id: 'cobalt2',
    name: 'Cobalt2',
    description: 'Cobalt2 with Atom One Light.',
    dark: ref('cobalt2'),
    light: ref('atom-one-light'),
  },
  {
    id: 'snazzy',
    name: 'Snazzy',
    description: 'Snazzy with GitHub Light.',
    dark: ref('snazzy'),
    light: ref('github-light'),
  },
  {
    id: 'material',
    name: 'Material',
    description: 'Material dark + light.',
    dark: ref('material'),
    light: ref('material-light'),
  },
]

function ref(id: string): ThemeSchemeRef {
  const scheme = ITERM_SCHEME_CATALOG.find((entry) => entry.id === id)
  if (!scheme) throw new Error(`Unknown scheme id: ${id}`)
  return scheme
}

export function getThemeSet(id: string): ThemeSetDefinition | undefined {
  return THEME_SETS.find((set) => set.id === id)
}

export function schemeRefForThemeSet(
  themeSet: ThemeSetDefinition,
  mode: 'light' | 'dark',
): ThemeSchemeRef | null {
  if (themeSet.builtin) return null
  return mode === 'dark' ? themeSet.dark ?? themeSet.light ?? null : themeSet.light ?? themeSet.dark ?? null
}

export function schemeUrl(file: string, base = ITERM_SCHEMES_BASE_URL): string {
  return `${base}/${encodeURIComponent(file)}`
}

export function findCatalogScheme(id: string): ThemeSchemeRef | undefined {
  return ITERM_SCHEME_CATALOG.find((entry) => entry.id === id)
}
