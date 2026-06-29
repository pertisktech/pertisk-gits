import { FolderGit2, FolderTree, Loader2 } from 'lucide-react'
import { projectInitial } from '../lib/projectInitial'
import styles from './GroupLandingHero.module.css'

function HeroStat({
  icon,
  label,
  value,
  loading,
}: {
  icon: React.ReactNode
  label: string
  value: number
  loading?: boolean
}) {
  return (
    <div className={styles.stat} title={`${value} ${label}`} aria-label={`${value} ${label}`}>
      {loading ? (
        <Loader2 size={16} className="animate-spin text-muted" aria-hidden />
      ) : (
        <>
          <span className={styles.statIcon} aria-hidden>
            {icon}
          </span>
          <span className={styles.statValue}>{value}</span>
        </>
      )}
    </div>
  )
}

export function GroupLandingHero({
  name,
  slug,
  path,
  description,
  subgroupCount,
  projectCount,
  statsLoading,
}: {
  name: string
  slug: string
  path: string
  description?: string | null
  subgroupCount: number
  projectCount: number
  statsLoading?: boolean
}) {
  return (
    <div className="app-panel mb-4">
      <div className={styles.hero}>
        <div className={styles.icon} aria-hidden>
          <span className={styles.iconLetter}>{projectInitial(name, slug)}</span>
        </div>
        <div className={styles.main}>
          <h1 className={styles.title}>{name}</h1>
          <p className={styles.path}>@{path}</p>
          {description && <p className={styles.description}>{description}</p>}
        </div>
        <div className={styles.stats}>
          <HeroStat
            icon={<FolderTree size={16} />}
            label="subgroups"
            value={subgroupCount}
            loading={statsLoading}
          />
          <HeroStat
            icon={<FolderGit2 size={16} />}
            label="projects"
            value={projectCount}
            loading={statsLoading}
          />
        </div>
      </div>
    </div>
  )
}
