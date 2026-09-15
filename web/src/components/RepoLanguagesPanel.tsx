import type { LanguageStat } from '../api/types'

export function RepoLanguagesPanel({ languages }: { languages: LanguageStat[] }) {
  if (languages.length === 0) return null

  return (
    <section className="rounded-xl border border-border bg-card/40 p-4">
      <h2 className="mb-2 text-sm font-semibold text-text m-0">Languages</h2>
      <div className="flex h-2 overflow-hidden rounded-full bg-hover">
        {languages.map((lang) => (
          <span
            key={lang.name}
            title={`${lang.name} ${lang.percent.toFixed(1)}%`}
            style={{
              width: `${Math.max(lang.percent, 0.5)}%`,
              backgroundColor: lang.color,
            }}
          />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5 text-sm text-muted list-none m-0 p-0">
        {languages.map((lang) => (
          <li key={lang.name} className="flex items-center gap-2">
            <span
              className="size-2.5 rounded-full shrink-0"
              style={{ backgroundColor: lang.color }}
              aria-hidden
            />
            <span className="text-text">{lang.name}</span>
            <span className="ml-auto tabular-nums">{lang.percent.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
