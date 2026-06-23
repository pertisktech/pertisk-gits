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

function appVersion(): string {
  const fromEnv = process.env.VERSION ?? process.env.VITE_APP_VERSION
  if (fromEnv) {
    return fromEnv.replace(/^[vV]/, '')
  }
  return workspaceVersion()
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
