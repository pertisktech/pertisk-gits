import { adaptItermSchemeToCssVars, type ThemeCssVars } from './adaptItermScheme'
import { parseItermColors, type ItermSchemeColors } from './parseItermColors'
import {
  findCatalogScheme,
  ITERM_SCHEME_CATALOG,
  ITERM_SCHEMES_REMOTE_URL,
  schemeUrl,
  type ThemeSchemeRef,
} from './themeSets'

const contentCache = new Map<string, string>()
const parsedCache = new Map<string, ItermSchemeColors>()
const cssCache = new Map<string, ThemeCssVars>()

function cacheKey(ref: ThemeSchemeRef, mode: 'light' | 'dark'): string {
  return `${ref.id}:${mode}`
}

function isItermColorsContent(content: string): boolean {
  return content.includes('<plist') && content.includes('Background Color')
}

async function fetchSchemeContentFrom(url: string): Promise<string | null> {
  const response = await fetch(url)
  if (!response.ok) return null
  const content = await response.text()
  if (!isItermColorsContent(content)) return null
  return content
}

export async function fetchItermSchemeContent(ref: ThemeSchemeRef): Promise<string> {
  const cached = contentCache.get(ref.id)
  if (cached && isItermColorsContent(cached)) return cached

  const content =
    (await fetchSchemeContentFrom(schemeUrl(ref.file))) ??
    (await fetchSchemeContentFrom(schemeUrl(ref.file, ITERM_SCHEMES_REMOTE_URL)))

  if (!content) {
    throw new Error(`Failed to load theme "${ref.name}" (404)`)
  }

  contentCache.set(ref.id, content)
  return content
}

export async function loadImportedSchemeContent(
  schemeId: string,
  importedSchemes: Record<string, { name: string; content: string }>,
): Promise<string> {
  const entry = importedSchemes[schemeId]
  if (!entry) throw new Error(`Imported scheme not found: ${schemeId}`)
  return entry.content
}

export async function resolveSchemeCssVars(
  ref: ThemeSchemeRef,
  mode: 'light' | 'dark',
  importedSchemes?: Record<string, { name: string; content: string }>,
): Promise<ThemeCssVars> {
  const key = cacheKey(ref, mode)
  const cached = cssCache.get(key)
  if (cached) return cached

  const content =
    ref.id.startsWith('imported:') && importedSchemes
      ? await loadImportedSchemeContent(ref.id, importedSchemes)
      : await fetchItermSchemeContent(ref)

  const parsed = parseItermColors(content, ref.name)
  parsedCache.set(ref.id, parsed)
  const vars = adaptItermSchemeToCssVars(parsed, mode)
  cssCache.set(key, vars)
  return vars
}

export async function resolveSchemeById(
  schemeId: string,
  mode: 'light' | 'dark',
  importedSchemes?: Record<string, { name: string; content: string }>,
): Promise<ThemeCssVars> {
  if (schemeId.startsWith('imported:')) {
    const entry = importedSchemes?.[schemeId]
    if (!entry) throw new Error('Imported scheme missing')
    const ref: ThemeSchemeRef = { id: schemeId, name: entry.name, file: '' }
    return resolveSchemeCssVars(ref, mode, importedSchemes)
  }

  const catalogRef = findCatalogScheme(schemeId)
  if (!catalogRef) throw new Error(`Unknown scheme: ${schemeId}`)
  return resolveSchemeCssVars(catalogRef, mode, importedSchemes)
}

export function parseImportedScheme(name: string, content: string): ItermSchemeColors {
  return parseItermColors(content, name)
}

export function listCatalogSchemes(): ThemeSchemeRef[] {
  return ITERM_SCHEME_CATALOG
}

export function clearSchemeCache(): void {
  contentCache.clear()
  parsedCache.clear()
  cssCache.clear()
}
