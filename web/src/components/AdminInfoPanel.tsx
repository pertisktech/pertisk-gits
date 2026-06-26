interface InfoRowProps {
  label: string
  value: React.ReactNode
}

export function InfoRow({ label, value }: InfoRowProps) {
  return (
    <div className="grid gap-1 border-b border-gray-200 py-3 last:border-b-0 sm:grid-cols-[minmax(10rem,14rem)_1fr] sm:gap-4 dark:border-gray-800">
      <dt className="text-theme-sm text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="text-theme-sm text-gray-800 dark:text-white/90 break-words">{value}</dd>
    </div>
  )
}

export function InfoPanel({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="shell-card">
      <div className="shell-card-header">{title}</div>
      <dl className="shell-card-body !py-0 divide-y divide-gray-200 dark:divide-gray-800">{children}</dl>
    </div>
  )
}
