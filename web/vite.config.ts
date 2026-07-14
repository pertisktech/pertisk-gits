import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function workspaceVersion(): string {
  const cargo = readFileSync(resolve(rootDir, 'Cargo.toml'), 'utf8')
  const match = cargo.match(/^version\s*=\s*"([^"]+)"/m)
  return match?.[1] ?? '0.0.0'
}

function gitDescribeVersion(): string | null {
  try {
    const tag = execSync('git describe --tags --always', {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return tag ? tag.replace(/^[vV]/, '') : null
  } catch {
    return null
  }
}

function appVersion(): string {
  const fromEnv = process.env.VERSION ?? process.env.VITE_APP_VERSION
  if (fromEnv) {
    return fromEnv.replace(/^[vV]/, '')
  }
  if (process.env.NODE_ENV === 'production') {
    return workspaceVersion()
  }
  return gitDescribeVersion() ?? workspaceVersion()
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion()),
  },
  server: {
    proxy: {
      '/api/v1': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
