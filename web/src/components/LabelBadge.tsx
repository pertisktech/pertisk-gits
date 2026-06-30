import type { Label } from '../api/types'

export function LabelBadge({ label }: { label: Label }) {
  return (
    <span
      className="text-2xs px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap"
      style={{ backgroundColor: `${label.color}22`, color: label.color }}
    >
      {label.name}
    </span>
  )
}
