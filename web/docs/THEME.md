# Pertisk Gits theme tokens

Design system based on [TailAdmin](https://tailadmin.com/) structure with **Pertisk violet** brand colors.

## Token mapping (pertisk → tailadmin)

| Pertisk (legacy) | TailAdmin / new token | Notes |
|------------------|----------------------|--------|
| `--color-primary-p4` | `--color-brand-500` | `#7c59f0` (was TailAdmin `#465fff` blue) |
| `--color-primary-p3` | `--color-brand-400` | Hover / links |
| `--color-primary-p5` | `--color-brand-600` | Pressed / dark accent |
| `--color-naturals-n0` … `n14` | `--color-gray-*` | Cool gray ramp |
| `--color-bg` | `--shell-bg` | Page background |
| `--color-surface` | `--shell-surface` | Cards, header |
| `--color-sidebar` | `--shell-sidebar-bg` | Sidebar fill |
| `--color-border` | `--shell-border` | Borders |
| `--color-text` | `--shell-text` | Primary text |
| `--color-text-secondary` | `--shell-text-secondary` | Secondary text |
| `--color-green-g1` | `--color-success-500` | Success states |
| `--color-red-r1` | `--color-error-500` | Errors |
| `--color-yellow-y1` | `--color-warning-500` | Warnings |
| `--shadow-sm` | `--shadow-theme-sm` | Card elevation |
| `--shadow-md` | `--shadow-theme-md` | Dropdowns |
| Inter (UI) | Outfit + Inter fallback | TailAdmin uses Outfit |
| JetBrains Mono | unchanged | Code, SHAs, paths |

## Tailwind classes

After `tailwind.config.js` extension:

| Utility | CSS variable |
|---------|----------------|
| `bg-brand-500` | `--color-brand-500` |
| `text-gray-500` | `--color-gray-500` |
| `border-gray-200` | `--color-gray-200` |
| `shadow-theme-sm` | `--shadow-theme-sm` |
| `dark:bg-gray-900` | Dark mode via `html.dark` |

## Dark mode

- `html.dark` — default (Pertisk)
- `html.light` — light mode
- Tailwind `dark:` utilities use `darkMode: 'class'` on `<html>`

## Files

| File | Purpose |
|------|---------|
| `src/styles/tokens.css` | Source of truth for colors, shadows, shell surfaces |
| `src/styles/shell.css` | App layout (sidebar, header, menu items) |
| `src/styles/theme.css` | Status badge utility classes |
| `src/index.css` | Legacy app panels, CI terminal, diff viewer |

## Migration status

| Area | Status |
|------|--------|
| Tokens + bridge | Done |
| App shell (sidebar, header) | Done |
| Dashboard | Done |
| Button, Badge, Input primitives | Done |
| Groups + Login + Register | Done |
| Group detail + repo header + tabs | Done |
| Import wizard (`GroupImportPage`) | Done |
| Admin (users, auth, health, system, config) | Done |
| Repo browser, commits, readme, pipelines | Done |
| Profile, group members/audit, runners | Done |
| Issues/PRs list + create forms | Done |
| Issue/PR detail, commit detail, settings, registry | Done |
| Auth callback | Done |
| CI diff viewer, pipeline terminal (legacy CSS) | Unchanged |

## Brand decision

**Violet Pertisk (option A):** TailAdmin layout and components; `brand-*` scale is purple, not blue.
