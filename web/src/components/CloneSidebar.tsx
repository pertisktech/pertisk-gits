import { Check, Copy, Lock } from 'lucide-react'
import { useState } from 'react'

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      <div className="text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wide">
        {label}
      </div>
      <div className="flex gap-1.5">
        <input readOnly value={value} className="gogs-clone-input flex-1" />
        <button
          type="button"
          onClick={copy}
          className="shrink-0 px-2.5 py-1.5 rounded-md border border-border text-text-secondary hover:bg-hover text-xs"
          data-no-global-button-hover="true"
          title="Copy"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  )
}

export function CloneSidebar({
  cloneUrl,
  authCloneUrl,
  cloneUrlSsh,
  defaultBranch,
  isPrivate,
}: {
  cloneUrl: string
  authCloneUrl: string
  cloneUrlSsh?: string | null
  defaultBranch: string
  isPrivate: boolean
}) {
  return (
    <div className="gogs-panel">
      <div className="gogs-panel-header">Clone</div>
      <div className="gogs-panel-body space-y-4">
        <CopyField label="HTTPS" value={cloneUrl} />
        {cloneUrlSsh && <CopyField label="SSH" value={cloneUrlSsh} />}
        {isPrivate && (
          <p className="text-xs text-text-secondary flex items-start gap-1.5">
            <Lock size={12} className="shrink-0 mt-0.5 text-blue-b1" />
            HTTPS: use your username and password when Git prompts.
            {cloneUrlSsh && ' SSH: add your public key under Profile.'}
          </p>
        )}
        <div>
          <div className="text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wide">
            Quick push
          </div>
          <pre className="m-0 p-2.5 rounded-md bg-bg border border-border font-mono text-[10px] text-text overflow-x-auto leading-relaxed">{`git remote add origin ${authCloneUrl}
git push -u origin ${defaultBranch}`}</pre>
        </div>
      </div>
    </div>
  )
}
