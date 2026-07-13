import { ExternalLink, Loader2, Moon, Palette, Sun, Trash2, Upload } from 'lucide-react'
import { useRef, useState, type ChangeEvent } from 'react'
import { useTheme } from '../context/ThemeContext'
import { ITERM_SCHEMES_REPO_URL } from '../lib/theme/themeSets'
import { PrimaryButton, SecondaryButton } from './ui'

function ThemePreviewSwatches() {
  const swatches = [
    { label: 'Background', var: '--color-bg' },
    { label: 'Surface', var: '--color-surface' },
    { label: 'Text', var: '--color-text' },
    { label: 'Primary', var: '--color-primary' },
    { label: 'Success', var: '--color-green-g1' },
    { label: 'Danger', var: '--color-red-r1' },
  ]

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {swatches.map((swatch) => (
        <div key={swatch.var} className="space-y-1">
          <div
            className="h-10 rounded-md border border-naturals-n4"
            style={{ background: `var(${swatch.var})` }}
            aria-hidden
          />
          <div className="text-2xs text-text-secondary">{swatch.label}</div>
        </div>
      ))}
    </div>
  )
}

export function ThemeSettingsPanel() {
  const {
    theme,
    themeSetId,
    themeSets,
    activeThemeSet,
    importedSchemes,
    loadingTheme,
    themeError,
    setTheme,
    setThemeSetId,
    importItermScheme,
    removeImportedScheme,
  } = useTheme()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  async function onImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.itermcolors')) {
      setImportError('Please choose an .itermcolors file from iTerm2-Color-Schemes.')
      return
    }

    setImporting(true)
    setImportError(null)
    try {
      await importItermScheme(file)
    } catch (err) {
      setImportError((err as Error).message)
    } finally {
      setImporting(false)
    }
  }

  const importedIds = Object.keys(importedSchemes)

  return (
    <div className="app-panel">
      <div className="app-panel-header flex items-center gap-2">
        <Palette size={15} className="text-primary" />
        Appearance
      </div>
      <div className="app-panel-body space-y-5">
        <p className="text-sm text-text-secondary">
          Choose a theme set adapted from{' '}
          <a
            href="https://github.com/mbadolato/iTerm2-Color-Schemes/tree/master/schemes"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-1"
          >
            iTerm2-Color-Schemes
            <ExternalLink size={12} />
          </a>
          . Dark and light modes use paired schemes when available.
        </p>

        <div className="flex flex-wrap gap-2">
          <SecondaryButton
            type="button"
            className={theme === 'dark' ? 'border-primary text-primary' : undefined}
            onClick={() => setTheme('dark')}
          >
            <Moon size={14} />
            Dark
          </SecondaryButton>
          <SecondaryButton
            type="button"
            className={theme === 'light' ? 'border-primary text-primary' : undefined}
            onClick={() => setTheme('light')}
          >
            <Sun size={14} />
            Light
          </SecondaryButton>
          {loadingTheme && (
            <span className="inline-flex items-center gap-1.5 text-xs text-text-secondary px-2">
              <Loader2 size={12} className="animate-spin" />
              Loading theme…
            </span>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="theme-set-select" className="text-sm font-medium text-text">
            Theme set
          </label>
          <select
            id="theme-set-select"
            className="app-field app-field--inline max-w-full"
            value={themeSetId}
            onChange={(e) => setThemeSetId(e.target.value)}
          >
            {themeSets.map((set) => (
              <option key={set.id} value={set.id}>
                {set.name}
              </option>
            ))}
          </select>
          {activeThemeSet.description && (
            <p className="text-xs text-text-secondary">{activeThemeSet.description}</p>
          )}
        </div>

        <ThemePreviewSwatches />

        {(themeError || importError) && (
          <div className="p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
            {themeError ?? importError}
          </div>
        )}

        <div className="space-y-3 pt-2 border-t border-naturals-n4">
          <div>
            <h3 className="text-sm font-medium text-text">Import iTerm2 scheme</h3>
            <p className="text-xs text-text-secondary mt-1">
              Upload any <code className="font-mono">.itermcolors</code> file from the{' '}
              <a href={ITERM_SCHEMES_REPO_URL} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                schemes folder
              </a>
              .
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".itermcolors,application/xml,text/xml"
            className="hidden"
            onChange={(e) => void onImportFile(e)}
          />
          <PrimaryButton
            type="button"
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
          >
            {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            Import .itermcolors
          </PrimaryButton>

          {importedIds.length > 0 && (
            <ul className="divide-y divide-naturals-n4 border border-naturals-n4 rounded-lg overflow-hidden">
              {importedIds.map((id) => (
                <li key={id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text">{importedSchemes[id]?.name}</div>
                    <div className="text-xs text-muted">Imported scheme</div>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 p-2 rounded-md border border-naturals-n4 text-text-secondary hover:text-dashboard-danger hover:border-red-r1/30"
                    title="Remove imported scheme"
                    onClick={() => removeImportedScheme(id)}
                    data-no-global-button-hover="true"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
