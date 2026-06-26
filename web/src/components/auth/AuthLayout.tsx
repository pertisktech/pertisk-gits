import type { ReactNode } from 'react'
import { Moon, Sun } from 'lucide-react'
import { Link } from 'react-router-dom'
import { AppVersion } from '../AppVersion'
import { useTheme } from '../../context/ThemeContext'

export function AuthLayout({
  title,
  subtitle,
  icon,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  icon?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  const { isDark, toggleTheme } = useTheme()

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-end border-b border-gray-200 bg-white px-5 dark:border-gray-800 dark:bg-gray-dark">
        <button
          type="button"
          onClick={toggleTheme}
          data-no-global-button-hover="true"
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-theme-sm text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-white/5"
        >
          {isDark ? <Sun size={16} /> : <Moon size={16} />}
          {isDark ? 'Light' : 'Dark'}
        </button>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-10">
        <Link to="/login" className="flex items-center gap-3 no-underline">
          <img src="/favicon.svg" alt="" className="h-12 w-12" />
          <span className="text-2xl font-semibold tracking-tight text-gray-800 dark:text-white/90">
            Pertisk Gits
          </span>
        </Link>

        <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-theme-md dark:border-gray-800 dark:bg-gray-dark">
          <div className="mb-6 text-center">
            <h1 className="flex items-center justify-center gap-2 text-xl font-semibold text-gray-800 dark:text-white/90">
              {icon}
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1.5 text-theme-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
            )}
          </div>
          {children}
        </div>

        {footer}
      </main>

      <footer className="flex h-12 items-center justify-center border-t border-gray-200 bg-white text-theme-xs text-gray-500 dark:border-gray-800 dark:bg-gray-dark dark:text-gray-400">
        <AppVersion />
      </footer>
    </div>
  )
}
