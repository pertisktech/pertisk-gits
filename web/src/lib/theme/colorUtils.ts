export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function componentToByte(value: number): number {
  return Math.round(clamp01(value) * 255)
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (byte: number) => byte.toString(16).padStart(2, '0')
  return `#${toHex(componentToByte(r))}${toHex(componentToByte(g))}${toHex(componentToByte(b))}`
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace('#', '')
  const value =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => char + char)
          .join('')
      : normalized
  const int = Number.parseInt(value, 16)
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  }
}

export function mixHex(a: string, b: string, amount: number): string {
  const t = clamp01(amount)
  const left = hexToRgb(a)
  const right = hexToRgb(b)
  return rgbToHex(
    (left.r + (right.r - left.r) * t) / 255,
    (left.g + (right.g - left.g) * t) / 255,
    (left.b + (right.b - left.b) * t) / 255,
  )
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  const transform = (channel: number) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * transform(r) + 0.7152 * transform(g) + 0.0722 * transform(b)
}

export function pickReadableText(background: string, preferred: string): string {
  if (contrastRatio(preferred, background) >= 4.5) return preferred
  const dark = '#181b2e'
  const light = '#e6e7f0'
  return contrastRatio(dark, background) >= contrastRatio(light, background) ? dark : light
}

export function pickOnPrimary(primary: string): string {
  const whiteContrast = contrastRatio(primary, '#ffffff')
  const blackContrast = contrastRatio(primary, '#0d0f1a')
  return whiteContrast >= blackContrast ? '#ffffff' : '#0d0f1a'
}

export function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a)
  const l2 = relativeLuminance(b)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

export function detectColorMode(background: string): 'light' | 'dark' {
  return relativeLuminance(background) > 0.45 ? 'light' : 'dark'
}

export function buildNeutralScale(
  background: string,
  foreground: string,
  mode: 'light' | 'dark',
): Record<string, string> {
  if (mode === 'dark') {
    return {
      n0: background,
      n1: mixHex(background, foreground, 0.04),
      n2: mixHex(background, foreground, 0.08),
      n3: mixHex(background, foreground, 0.12),
      n4: mixHex(background, foreground, 0.16),
      n5: mixHex(background, foreground, 0.22),
      n6: mixHex(background, foreground, 0.32),
      n7: mixHex(background, foreground, 0.42),
      n8: mixHex(background, foreground, 0.52),
      n9: mixHex(background, foreground, 0.62),
      n10: mixHex(background, foreground, 0.72),
      n11: mixHex(foreground, background, 0.15),
      n12: mixHex(foreground, background, 0.35),
      n13: foreground,
      n14: '#ffffff',
    }
  }

  return {
    n0: mixHex(background, '#ffffff', 0.65),
    n1: mixHex(background, '#ffffff', 0.78),
    n2: mixHex(background, '#ffffff', 0.88),
    n3: mixHex(background, '#ffffff', 0.94),
    n4: mixHex(background, foreground, 0.08),
    n5: mixHex(background, foreground, 0.14),
    n6: mixHex(background, foreground, 0.22),
    n7: mixHex(background, foreground, 0.32),
    n8: mixHex(background, foreground, 0.42),
    n9: mixHex(background, foreground, 0.52),
    n10: mixHex(background, foreground, 0.62),
    n11: mixHex(foreground, background, 0.25),
    n12: mixHex(foreground, background, 0.45),
    n13: foreground,
    n14: mixHex(foreground, '#000000', 0.25),
  }
}
