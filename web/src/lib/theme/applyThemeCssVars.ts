import { PERTISK_DEFAULT_THEME_SET_ID } from './themeSets'
import { THEME_OVERRIDE_VARS, type ThemeCssVars } from './adaptItermScheme'

const STYLE_ID = 'pertisk-theme-overrides'

export type ThemeModeVars = Partial<Record<'light' | 'dark', ThemeCssVars>>

function cssBlock(mode: 'light' | 'dark', themeSetId: string, vars: ThemeCssVars): string {
  const body = Object.entries(vars)
    .map(([key, value]) => `${key}: ${value};`)
    .join('\n  ')
  return `html.${mode}[data-theme-set="${themeSetId}"] {\n  ${body}\n}`
}

export function applyThemeCssVars(themeSetId: string, varsByMode: ThemeModeVars | null): void {
  const root = document.documentElement
  root.dataset.themeSet = themeSetId

  for (const name of THEME_OVERRIDE_VARS) {
    root.style.removeProperty(name)
  }

  const existing = document.getElementById(STYLE_ID)
  if (!varsByMode || themeSetId === PERTISK_DEFAULT_THEME_SET_ID) {
    existing?.remove()
    return
  }

  const blocks: string[] = []
  if (varsByMode.dark) blocks.push(cssBlock('dark', themeSetId, varsByMode.dark))
  if (varsByMode.light) blocks.push(cssBlock('light', themeSetId, varsByMode.light))

  if (blocks.length === 0) {
    existing?.remove()
    return
  }

  const styleEl = existing ?? document.createElement('style')
  styleEl.id = STYLE_ID
  styleEl.textContent = blocks.join('\n\n')
  if (!existing) {
    document.head.appendChild(styleEl)
  }
}

export function clearThemeCssVars(): void {
  applyThemeCssVars(PERTISK_DEFAULT_THEME_SET_ID, null)
}
