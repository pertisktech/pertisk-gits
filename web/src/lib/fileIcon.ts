export interface FileIconStyle {
  label: string
  color: string
  bg: string
}

const DEFAULT_FILE: FileIconStyle = {
  label: 'FILE',
  color: '#a8aac6',
  bg: 'color-mix(in srgb, #a8aac6 18%, transparent)',
}

const BY_EXTENSION: Record<string, FileIconStyle> = {
  ts: { label: 'TS', color: '#3178c6', bg: 'color-mix(in srgb, #3178c6 22%, transparent)' },
  tsx: { label: 'TSX', color: '#3178c6', bg: 'color-mix(in srgb, #3178c6 22%, transparent)' },
  js: { label: 'JS', color: '#d4a72c', bg: 'color-mix(in srgb, #d4a72c 22%, transparent)' },
  jsx: { label: 'JSX', color: '#d4a72c', bg: 'color-mix(in srgb, #d4a72c 22%, transparent)' },
  mjs: { label: 'MJS', color: '#d4a72c', bg: 'color-mix(in srgb, #d4a72c 22%, transparent)' },
  cjs: { label: 'CJS', color: '#d4a72c', bg: 'color-mix(in srgb, #d4a72c 22%, transparent)' },
  rs: { label: 'RS', color: '#e8912d', bg: 'color-mix(in srgb, #e8912d 22%, transparent)' },
  go: { label: 'GO', color: '#00add8', bg: 'color-mix(in srgb, #00add8 20%, transparent)' },
  py: { label: 'PY', color: '#3b82f6', bg: 'color-mix(in srgb, #3b82f6 20%, transparent)' },
  rb: { label: 'RB', color: '#e11d48', bg: 'color-mix(in srgb, #e11d48 18%, transparent)' },
  java: { label: 'JAVA', color: '#ea580c', bg: 'color-mix(in srgb, #ea580c 18%, transparent)' },
  kt: { label: 'KT', color: '#a855f7', bg: 'color-mix(in srgb, #a855f7 20%, transparent)' },
  swift: { label: 'SWFT', color: '#f97316', bg: 'color-mix(in srgb, #f97316 20%, transparent)' },
  c: { label: 'C', color: '#64748b', bg: 'color-mix(in srgb, #64748b 20%, transparent)' },
  h: { label: 'H', color: '#64748b', bg: 'color-mix(in srgb, #64748b 20%, transparent)' },
  cpp: { label: 'CPP', color: '#2563eb', bg: 'color-mix(in srgb, #2563eb 20%, transparent)' },
  hpp: { label: 'HPP', color: '#2563eb', bg: 'color-mix(in srgb, #2563eb 20%, transparent)' },
  cs: { label: 'CS', color: '#8b5cf6', bg: 'color-mix(in srgb, #8b5cf6 20%, transparent)' },
  php: { label: 'PHP', color: '#7c3aed', bg: 'color-mix(in srgb, #7c3aed 20%, transparent)' },
  html: { label: 'HTML', color: '#ea580c', bg: 'color-mix(in srgb, #ea580c 18%, transparent)' },
  htm: { label: 'HTM', color: '#ea580c', bg: 'color-mix(in srgb, #ea580c 18%, transparent)' },
  css: { label: 'CSS', color: '#ec4899', bg: 'color-mix(in srgb, #ec4899 18%, transparent)' },
  scss: { label: 'SCSS', color: '#ec4899', bg: 'color-mix(in srgb, #ec4899 18%, transparent)' },
  sass: { label: 'SASS', color: '#ec4899', bg: 'color-mix(in srgb, #ec4899 18%, transparent)' },
  less: { label: 'LESS', color: '#0ea5e9', bg: 'color-mix(in srgb, #0ea5e9 18%, transparent)' },
  vue: { label: 'VUE', color: '#22c55e', bg: 'color-mix(in srgb, #22c55e 18%, transparent)' },
  svelte: { label: 'SVEL', color: '#ef4444', bg: 'color-mix(in srgb, #ef4444 18%, transparent)' },
  json: { label: 'JSON', color: '#ca8a04', bg: 'color-mix(in srgb, #ca8a04 20%, transparent)' },
  yaml: { label: 'YAML', color: '#a855f7', bg: 'color-mix(in srgb, #a855f7 18%, transparent)' },
  yml: { label: 'YML', color: '#a855f7', bg: 'color-mix(in srgb, #a855f7 18%, transparent)' },
  toml: { label: 'TOML', color: '#a855f7', bg: 'color-mix(in srgb, #a855f7 18%, transparent)' },
  xml: { label: 'XML', color: '#f59e0b', bg: 'color-mix(in srgb, #f59e0b 18%, transparent)' },
  md: { label: 'MD', color: '#94a3b8', bg: 'color-mix(in srgb, #94a3b8 22%, transparent)' },
  mdx: { label: 'MDX', color: '#94a3b8', bg: 'color-mix(in srgb, #94a3b8 22%, transparent)' },
  sql: { label: 'SQL', color: '#0ea5e9', bg: 'color-mix(in srgb, #0ea5e9 18%, transparent)' },
  sh: { label: 'SH', color: '#22c55e', bg: 'color-mix(in srgb, #22c55e 18%, transparent)' },
  bash: { label: 'BASH', color: '#22c55e', bg: 'color-mix(in srgb, #22c55e 18%, transparent)' },
  zsh: { label: 'ZSH', color: '#22c55e', bg: 'color-mix(in srgb, #22c55e 18%, transparent)' },
  dockerfile: { label: 'DOCK', color: '#0ea5e9', bg: 'color-mix(in srgb, #0ea5e9 18%, transparent)' },
  lock: { label: 'LOCK', color: '#94a3b8', bg: 'color-mix(in srgb, #94a3b8 18%, transparent)' },
  env: { label: 'ENV', color: '#eab308', bg: 'color-mix(in srgb, #eab308 18%, transparent)' },
  svg: { label: 'SVG', color: '#f97316', bg: 'color-mix(in srgb, #f97316 18%, transparent)' },
  png: { label: 'PNG', color: '#a78bfa', bg: 'color-mix(in srgb, #a78bfa 18%, transparent)' },
  jpg: { label: 'JPG', color: '#a78bfa', bg: 'color-mix(in srgb, #a78bfa 18%, transparent)' },
  jpeg: { label: 'JPEG', color: '#a78bfa', bg: 'color-mix(in srgb, #a78bfa 18%, transparent)' },
  gif: { label: 'GIF', color: '#a78bfa', bg: 'color-mix(in srgb, #a78bfa 18%, transparent)' },
  webp: { label: 'WEBP', color: '#a78bfa', bg: 'color-mix(in srgb, #a78bfa 18%, transparent)' },
  ico: { label: 'ICO', color: '#a78bfa', bg: 'color-mix(in srgb, #a78bfa 18%, transparent)' },
  wasm: { label: 'WASM', color: '#6366f1', bg: 'color-mix(in srgb, #6366f1 18%, transparent)' },
  tf: { label: 'TF', color: '#7c3aed', bg: 'color-mix(in srgb, #7c3aed 18%, transparent)' },
  proto: { label: 'PROTO', color: '#22c55e', bg: 'color-mix(in srgb, #22c55e 18%, transparent)' },
}

const BY_BASENAME: Record<string, FileIconStyle> = {
  dockerfile: { label: 'DOCK', color: '#0ea5e9', bg: 'color-mix(in srgb, #0ea5e9 18%, transparent)' },
  makefile: { label: 'MAKE', color: '#64748b', bg: 'color-mix(in srgb, #64748b 20%, transparent)' },
  license: { label: 'LIC', color: '#94a3b8', bg: 'color-mix(in srgb, #94a3b8 20%, transparent)' },
  readme: { label: 'README', color: '#94a3b8', bg: 'color-mix(in srgb, #94a3b8 20%, transparent)' },
  '.gitignore': { label: 'GIT', color: '#f97316', bg: 'color-mix(in srgb, #f97316 18%, transparent)' },
  '.gitattributes': { label: 'GIT', color: '#f97316', bg: 'color-mix(in srgb, #f97316 18%, transparent)' },
  '.dockerignore': { label: 'DOCK', color: '#0ea5e9', bg: 'color-mix(in srgb, #0ea5e9 18%, transparent)' },
  '.pertisk-ci.yaml': { label: 'CI', color: '#a855f7', bg: 'color-mix(in srgb, #a855f7 18%, transparent)' },
  '.gitlab-ci.yml': { label: 'CI', color: '#fc6d26', bg: 'color-mix(in srgb, #fc6d26 18%, transparent)' },
  'cargo.toml': { label: 'CARGO', color: '#e8912d', bg: 'color-mix(in srgb, #e8912d 20%, transparent)' },
  'cargo.lock': { label: 'LOCK', color: '#94a3b8', bg: 'color-mix(in srgb, #94a3b8 18%, transparent)' },
  'package.json': { label: 'NPM', color: '#cb3837', bg: 'color-mix(in srgb, #cb3837 18%, transparent)' },
  'package-lock.json': { label: 'NPM', color: '#cb3837', bg: 'color-mix(in srgb, #cb3837 18%, transparent)' },
  'pnpm-lock.yaml': { label: 'PNPM', color: '#f59e0b', bg: 'color-mix(in srgb, #f59e0b 18%, transparent)' },
  'go.mod': { label: 'GO', color: '#00add8', bg: 'color-mix(in srgb, #00add8 20%, transparent)' },
  'go.sum': { label: 'GO', color: '#00add8', bg: 'color-mix(in srgb, #00add8 20%, transparent)' },
}

function extensionOf(filename: string): string | null {
  const base = filename.includes('/') ? filename.slice(filename.lastIndexOf('/') + 1) : filename
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return null
  return base.slice(dot + 1).toLowerCase()
}

function basenameOf(filename: string): string {
  const base = filename.includes('/') ? filename.slice(filename.lastIndexOf('/') + 1) : filename
  return base.toLowerCase()
}

export function getFileIconStyle(filename: string): FileIconStyle {
  const baseKey = basenameOf(filename)
  if (BY_BASENAME[baseKey]) {
    return BY_BASENAME[baseKey]
  }

  if (baseKey.startsWith('dockerfile')) {
    return BY_EXTENSION.dockerfile
  }

  const ext = extensionOf(filename)
  if (ext && BY_EXTENSION[ext]) {
    return BY_EXTENSION[ext]
  }

  if (ext) {
    const label = ext.length <= 4 ? ext.toUpperCase() : ext.slice(0, 4).toUpperCase()
    return {
      label,
      color: DEFAULT_FILE.color,
      bg: DEFAULT_FILE.bg,
    }
  }

  return DEFAULT_FILE
}
