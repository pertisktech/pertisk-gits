import type { ItermSchemeColors } from './parseItermColors'
import {
  buildNeutralScale,
  detectColorMode,
  mixHex,
  pickOnPrimary,
  pickReadableText,
  relativeLuminance,
} from './colorUtils'

export type ThemeCssVars = Record<string, string>

export const THEME_OVERRIDE_VARS = [
  '--color-naturals-n0',
  '--color-naturals-n1',
  '--color-naturals-n2',
  '--color-naturals-n3',
  '--color-naturals-n4',
  '--color-naturals-n5',
  '--color-naturals-n6',
  '--color-naturals-n7',
  '--color-naturals-n8',
  '--color-naturals-n9',
  '--color-naturals-n10',
  '--color-naturals-n11',
  '--color-naturals-n12',
  '--color-naturals-n13',
  '--color-naturals-n14',
  '--color-primary-p1',
  '--color-primary-p2',
  '--color-primary-p3',
  '--color-primary-p4',
  '--color-primary-p5',
  '--color-primary-p6',
  '--color-green-g1',
  '--color-green-g2',
  '--color-red-r1',
  '--color-red-r2',
  '--color-yellow-y1',
  '--color-yellow-y2',
  '--color-blue-b1',
  '--color-bg',
  '--color-surface',
  '--color-surface-elevated',
  '--color-hover',
  '--color-border',
  '--color-text',
  '--color-text-secondary',
  '--color-muted',
  '--color-card',
  '--color-sidebar',
  '--color-primary',
  '--color-primary-hover',
  '--color-on-primary',
  '--color-bg-gradient-start',
  '--color-bg-gradient-end',
  '--color-overlay-backdrop',
  '--color-icon-primary',
  '--color-icon-secondary',
  '--color-icon-success',
  '--color-icon-warning',
  '--color-icon-danger',
  '--color-icon-info',
  '--color-status-ready',
  '--color-workload-accent',
  '--color-workload-accent-strong',
  '--color-dashboard-metric-secondary',
  '--color-dashboard-metric-tertiary',
  '--color-dashboard-metric-quaternary',
  '--label-green',
  '--label-red',
  '--label-orange',
  '--label-violet',
  '--label-yellow',
  '--label-cyan',
  '--label-blue1',
  '--label-blue2',
  '--label-blue3',
  '--color-terminal-user',
  '--color-terminal-host',
  '--color-terminal-path',
  '--color-terminal-ok',
  '--color-terminal-error',
  '--color-terminal-warn',
  '--color-terminal-shadow',
  '--color-terminal-mix',
  '--shadow-sm',
  '--shadow-md',
  '--shadow-lg',
  '--shadow-sidebar',
  '--color-primary-glow',
] as const

function pickPrimary(ansi: string[]): string {
  return ansi[5] || ansi[4] || ansi[6] || ansi[3] || '#7c59f0'
}

export function adaptItermSchemeToCssVars(
  scheme: ItermSchemeColors,
  modeOverride?: 'light' | 'dark',
): ThemeCssVars {
  const mode = modeOverride ?? detectColorMode(scheme.background)
  const schemeIsLight = detectColorMode(scheme.background) === 'light'
  const neutrals = buildNeutralScale(scheme.background, scheme.foreground, mode)
  const primary = pickPrimary(scheme.ansi)
  const primaryHover = mixHex(primary, scheme.foreground, mode === 'dark' ? 0.22 : 0.12)
  const isLight = mode === 'light'

  const background = isLight && !schemeIsLight ? neutrals.n0 : scheme.background
  const surface = isLight ? neutrals.n0 : neutrals.n1
  const foreground = pickReadableText(surface, scheme.foreground)
  const textSecondary = pickReadableText(surface, neutrals.n11)

  const vars: ThemeCssVars = {
    '--color-naturals-n0': neutrals.n0,
    '--color-naturals-n1': neutrals.n1,
    '--color-naturals-n2': neutrals.n2,
    '--color-naturals-n3': neutrals.n3,
    '--color-naturals-n4': neutrals.n4,
    '--color-naturals-n5': neutrals.n5,
    '--color-naturals-n6': neutrals.n6,
    '--color-naturals-n7': neutrals.n7,
    '--color-naturals-n8': neutrals.n8,
    '--color-naturals-n9': neutrals.n9,
    '--color-naturals-n10': neutrals.n10,
    '--color-naturals-n11': neutrals.n11,
    '--color-naturals-n12': neutrals.n12,
    '--color-naturals-n13': foreground,
    '--color-naturals-n14': neutrals.n14,
    '--color-primary-p1': mixHex(primary, scheme.background, isLight ? 0.82 : 0.72),
    '--color-primary-p2': mixHex(primary, scheme.background, isLight ? 0.62 : 0.48),
    '--color-primary-p3': primary,
    '--color-primary-p4': mixHex(primary, '#000000', isLight ? 0.12 : 0.18),
    '--color-primary-p5': mixHex(primary, '#000000', isLight ? 0.24 : 0.32),
    '--color-primary-p6': mixHex(primary, scheme.background, isLight ? 0.9 : 0.78),
    '--color-green-g1': scheme.ansi[2] ?? '#22a06b',
    '--color-green-g2': scheme.ansi[10] ?? scheme.ansi[2] ?? '#116329',
    '--color-red-r1': scheme.ansi[1] ?? '#ff5c56',
    '--color-red-r2': scheme.ansi[9] ?? scheme.ansi[1] ?? '#6e2f30',
    '--color-yellow-y1': scheme.ansi[3] ?? '#fbbf24',
    '--color-yellow-y2': scheme.ansi[11] ?? scheme.ansi[3] ?? '#d97706',
    '--color-blue-b1': scheme.ansi[4] ?? '#60a5fa',
    '--color-bg': background,
    '--color-surface': surface,
    '--color-surface-elevated': neutrals.n2,
    '--color-hover': neutrals.n4,
    '--color-border': neutrals.n5,
    '--color-text': foreground,
    '--color-text-secondary': textSecondary,
    '--color-muted': pickReadableText(surface, neutrals.n9),
    '--color-card': neutrals.n2,
    '--color-sidebar': mode === 'dark' ? mixHex(scheme.background, '#000000', 0.35) : neutrals.n1,
    '--color-primary': primary,
    '--color-primary-hover': primaryHover,
    '--color-on-primary': pickOnPrimary(primary),
    '--color-bg-gradient-start': background,
    '--color-bg-gradient-end': neutrals.n1,
    '--color-overlay-backdrop': isLight ? 'rgba(24, 27, 46, 0.42)' : 'rgba(0, 0, 0, 0.75)',
    '--color-icon-primary': primary,
    '--color-icon-secondary': neutrals.n10,
    '--color-icon-success': scheme.ansi[2] ?? '#22a06b',
    '--color-icon-warning': scheme.ansi[3] ?? '#fbbf24',
    '--color-icon-danger': scheme.ansi[1] ?? '#ff5c56',
    '--color-icon-info': scheme.ansi[4] ?? '#60a5fa',
    '--color-status-ready': scheme.ansi[6] ?? '#25a7a0',
    '--color-workload-accent': scheme.ansi[6] ?? '#14b8a6',
    '--color-workload-accent-strong': scheme.ansi[14] ?? scheme.ansi[6] ?? '#0f766e',
    '--color-dashboard-metric-secondary': scheme.ansi[5] ?? primary,
    '--color-dashboard-metric-tertiary': scheme.ansi[13] ?? scheme.ansi[5] ?? '#ec4899',
    '--color-dashboard-metric-quaternary': scheme.ansi[6] ?? '#06b6d4',
    '--label-green': scheme.ansi[2] ?? '#61ff9b',
    '--label-red': scheme.ansi[1] ?? '#fc2226',
    '--label-orange': scheme.ansi[9] ?? '#f67a51',
    '--label-violet': scheme.ansi[5] ?? '#fd90e6',
    '--label-yellow': scheme.ansi[3] ?? '#fcdf69',
    '--label-cyan': scheme.ansi[6] ?? '#00c4d6',
    '--label-blue1': scheme.ansi[4] ?? '#6fabeb',
    '--label-blue2': scheme.ansi[12] ?? scheme.ansi[4] ?? '#3388ff',
    '--label-blue3': scheme.ansi[13] ?? scheme.ansi[5] ?? '#9675f0',
    '--color-terminal-user': scheme.ansi[2] ?? '#7ee787',
    '--color-terminal-host': scheme.ansi[4] ?? '#79c0ff',
    '--color-terminal-path': scheme.ansi[5] ?? '#d2a8ff',
    '--color-terminal-ok': scheme.ansi[2] ?? '#7ee787',
    '--color-terminal-error': scheme.ansi[1] ?? '#ff7b72',
    '--color-terminal-warn': scheme.ansi[3] ?? '#d29922',
    '--color-terminal-shadow': isLight
      ? 'color-mix(in srgb, black 8%, transparent)'
      : 'color-mix(in srgb, black 28%, transparent)',
    '--color-terminal-mix': isLight ? neutrals.n7 : '#000000',
    '--shadow-sm': isLight ? '0 1px 2px rgba(24, 27, 46, 0.06)' : '0 1px 2px rgba(0, 0, 0, 0.28)',
    '--shadow-md': isLight ? '0 8px 24px rgba(24, 27, 46, 0.08)' : '0 8px 24px rgba(0, 0, 0, 0.35)',
    '--shadow-lg': isLight ? '0 16px 48px rgba(24, 27, 46, 0.12)' : '0 16px 48px rgba(0, 0, 0, 0.45)',
    '--shadow-sidebar': isLight
      ? `0 0 0 1px color-mix(in srgb, ${primary} 12%, transparent), 8px 0 16px rgba(24, 27, 46, 0.04)`
      : '0 0 0 1px rgba(31, 34, 46, 0.95), 8px 0 24px rgba(0, 0, 0, 0.32)',
    '--color-primary-glow': `color-mix(in srgb, ${primary} ${isLight ? '18' : '28'}%, transparent)`,
  }

  if (scheme.selection && relativeLuminance(scheme.selection) > 0.05) {
    vars['--color-hover'] = mixHex(scheme.selection, scheme.background, 0.35)
  }

  return vars
}
