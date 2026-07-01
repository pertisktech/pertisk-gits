import { Check, Copy } from 'lucide-react'
import { useState } from 'react'

interface TypeToConfirmFieldProps {
  confirmText: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function TypeToConfirmField({
  confirmText,
  value,
  onChange,
  placeholder,
}: TypeToConfirmFieldProps) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(confirmText)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard may be unavailable
    }
  }

  return (
    <label className="block">
      <span className="text-text-secondary">
        Type{' '}
        <span className="inline-flex items-center gap-1 font-mono text-text">
          {confirmText}
          <button
            type="button"
            onClick={copy}
            className="rounded p-0.5 text-text-secondary hover:bg-hover hover:text-text"
            title={copied ? 'Copied!' : 'Copy'}
            aria-label={copied ? 'Copied' : `Copy ${confirmText}`}
            data-no-global-button-hover="true"
          >
            {copied ? <Check size={12} className="text-primary" /> : <Copy size={12} />}
          </button>
        </span>{' '}
        to confirm
      </span>
      <input
        className="app-field mt-1.5 font-mono"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        placeholder={placeholder ?? confirmText}
      />
    </label>
  )
}
