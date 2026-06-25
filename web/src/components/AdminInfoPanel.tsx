interface InfoRowProps {
  label: string
  value: React.ReactNode
}

export function InfoRow({ label, value }: InfoRowProps) {
  return (
    <div className="admin-info-row">
      <dt className="admin-info-label">{label}</dt>
      <dd className="admin-info-value">{value}</dd>
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
    <div className="app-panel">
      <div className="app-panel-header">{title}</div>
      <dl className="app-panel-body admin-info-list">{children}</dl>
    </div>
  )
}
