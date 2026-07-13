import { rgbToHex } from './colorUtils'

export interface ItermSchemeColors {
  name: string
  background: string
  foreground: string
  bold?: string
  selection?: string
  cursor?: string
  ansi: string[]
}

function parseColorBlock(block: string): string | null {
  const red = block.match(/<key>Red Component<\/key>\s*<real>([\d.]+)<\/real>/)
  const green = block.match(/<key>Green Component<\/key>\s*<real>([\d.]+)<\/real>/)
  const blue = block.match(/<key>Blue Component<\/key>\s*<real>([\d.]+)<\/real>/)
  if (!red || !green || !blue) return null
  return rgbToHex(Number(red[1]), Number(green[1]), Number(blue[1]))
}

export function parseItermColors(content: string, fallbackName = 'Imported'): ItermSchemeColors {
  const ansi = Array.from({ length: 16 }, () => '#000000')
  let background = '#000000'
  let foreground = '#ffffff'
  let bold: string | undefined
  let selection: string | undefined
  let cursor: string | undefined

  const dictPattern = /<key>([^<]+)<\/key>\s*<dict>([\s\S]*?)<\/dict>/g
  for (const match of content.matchAll(dictPattern)) {
    const key = match[1]?.trim()
    const block = match[2] ?? ''
    const color = parseColorBlock(block)
    if (!color || !key) continue

    const ansiMatch = /^Ansi (\d+) Color$/.exec(key)
    if (ansiMatch) {
      ansi[Number(ansiMatch[1])] = color
      continue
    }

    switch (key) {
      case 'Background Color':
        background = color
        break
      case 'Foreground Color':
        foreground = color
        break
      case 'Bold Color':
        bold = color
        break
      case 'Selection Color':
        selection = color
        break
      case 'Cursor Color':
        cursor = color
        break
      default:
        break
    }
  }

  const nameMatch = content.match(/<key>Color Scheme Name<\/key>\s*<string>([^<]+)<\/string>/)
  const name = nameMatch?.[1]?.trim() || fallbackName.replace(/\.itermcolors$/i, '')

  return {
    name,
    background,
    foreground,
    bold,
    selection,
    cursor,
    ansi,
  }
}
