import { Check, Copy, Lock } from 'lucide-react'
import { useState } from 'react'

interface RepoClonePanelProps {
  cloneUrl: string
  authCloneUrl: string
  cloneUrlSsh?: string | null
  defaultBranch: string
  isPrivate: boolean
}

function CloneCodeBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore — clipboard may be unavailable
    }
  }

  return (
    <div>
      <div className="text-xs font-semibold text-text-secondary mb-2 uppercase tracking-wide">
        {label}
      </div>
      <div className="relative group">
        <pre className="m-0 p-3 pr-10 rounded-md bg-bg border border-border font-mono text-xs text-text overflow-x-auto leading-relaxed whitespace-pre-wrap">
          {code}
        </pre>
        <button
          type="button"
          onClick={copy}
          className="absolute top-2 right-2 inline-flex items-center justify-center w-7 h-7 rounded-md border border-border bg-surface text-text-secondary hover:text-text hover:border-primary/40 transition-colors"
          aria-label={copied ? 'Copied' : `Copy ${label}`}
          title={copied ? 'Copied!' : 'Copy to clipboard'}
        >
          {copied ? <Check size={14} className="text-primary" /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  )
}

export function RepoClonePanel({
  cloneUrl,
  authCloneUrl,
  cloneUrlSsh,
  defaultBranch,
  isPrivate,
}: RepoClonePanelProps) {
  const httpClone = `git clone ${cloneUrl}`
  const sshClone = cloneUrlSsh ? `git clone ${cloneUrlSsh}` : null
  const pushExisting = `cd my-project
git init --initial-branch=${defaultBranch}
git remote add origin ${authCloneUrl}
git add .
git commit -m "Initial commit"
git push -u origin ${defaultBranch}`

  return (
    <div className="gogs-panel">
      <div className="gogs-panel-header">Clone this repository</div>
      <div className="gogs-panel-body space-y-5">
        <CloneCodeBlock label="HTTP" code={httpClone} />
        {sshClone && <CloneCodeBlock label="SSH" code={sshClone} />}
        <CloneCodeBlock label="Push an existing project" code={pushExisting} />
        {isPrivate && (
          <p className="text-sm text-text-secondary flex items-start gap-2 p-3 rounded-md bg-dashboard-info-bg border border-blue-b1/20">
            <Lock size={14} className="text-blue-b1 shrink-0 mt-0.5" />
            Private repository — use your Pertisk Gits account password when Git prompts.
          </p>
        )}
      </div>
    </div>
  )
}
