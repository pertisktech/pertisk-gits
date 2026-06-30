import { Check, Copy, Lock } from 'lucide-react'
import { useState } from 'react'

export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard may be unavailable
    }
  }

  return (
    <div>
      <div className="text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wide">
        {label}
      </div>
      <div className="flex gap-1.5">
        <input readOnly value={value} className="app-clone-input flex-1" />
        <button
          type="button"
          onClick={copy}
          className="shrink-0 px-2.5 py-1.5 rounded-md border border-naturals-n4 text-text-secondary hover:bg-hover text-xs"
          data-no-global-button-hover="true"
          title={copied ? 'Copied!' : 'Copy'}
        >
          {copied ? <Check size={14} className="text-primary" /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  )
}

interface RepoClonePushGuideProps {
  cloneUrl: string
  authCloneUrl: string
  cloneUrlSsh?: string | null
  defaultBranch: string
  isPrivate?: boolean
}

export function RepoClonePushGuide({
  cloneUrl,
  authCloneUrl,
  cloneUrlSsh,
  defaultBranch,
  isPrivate = false,
}: RepoClonePushGuideProps) {
  const [mode, setMode] = useState<'https' | 'ssh'>('https')
  const useSsh = mode === 'ssh' && Boolean(cloneUrlSsh)
  const activeCloneUrl = useSsh ? cloneUrlSsh! : cloneUrl
  const pushRemoteUrl = useSsh ? cloneUrlSsh! : authCloneUrl

  const modes: { id: 'https' | 'ssh'; label: string }[] = [
    { id: 'https', label: 'HTTPS' },
    ...(cloneUrlSsh ? [{ id: 'ssh' as const, label: 'SSH' }] : []),
  ]

  return (
    <div className="max-w-xl mx-auto text-left">
      {modes.length > 1 && (
        <div
          className="app-code-dropdown-tabs rounded-t-lg overflow-hidden border border-b-0 border-naturals-n4"
          role="tablist"
        >
          {modes.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={mode === item.id}
              className={mode === item.id ? 'active' : undefined}
              onClick={() => setMode(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      <div
        className={`space-y-4 p-4 border border-naturals-n4 bg-surface ${
          modes.length > 1 ? 'rounded-b-lg' : 'rounded-lg'
        }`}
      >
        <CopyField label="Clone" value={activeCloneUrl} />
        <CopyField label="Clone command" value={`git clone ${activeCloneUrl}`} />

        {isPrivate && !useSsh && (
          <p className="text-xs text-text-secondary flex items-start gap-1.5">
            <Lock size={12} className="shrink-0 mt-0.5 text-blue-b1" />
            Use your username and password when Git prompts.
          </p>
        )}

        {useSsh && (
          <p className="text-xs text-text-secondary">
            Add your public key under Profile before cloning over SSH.
          </p>
        )}

        <div className="pt-3 border-t border-naturals-n4 space-y-3">
          <div className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
            Push an existing project
          </div>
          <pre className="m-0 p-2.5 rounded-md bg-bg border border-naturals-n4 font-mono text-2xs text-text overflow-x-auto leading-relaxed whitespace-pre-wrap">{`git remote add origin ${pushRemoteUrl}
git push -u origin ${defaultBranch}`}</pre>
        </div>
      </div>
    </div>
  )
}
