export interface DetailTab {
  id: string
  label: string
}

export function RepoDetailTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: DetailTab[]
  active: string
  onChange: (id: string) => void
}) {
  return (
    <div className="repo-list-header">
      <div className="repo-list-header-segment">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`repo-list-tab ${active === tab.id ? 'active' : ''}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  )
}
