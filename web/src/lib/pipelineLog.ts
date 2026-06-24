import type { JobRun } from '../api/types'

export interface LogStepSection {
  name: string
  exitCode: number | null
  text: string
}

export interface JobStepView {
  key: string
  name: string
  run?: string
  exitCode?: number
  durationMs?: number
}

export function parseLogSteps(logText: string): LogStepSection[] {
  const sections: LogStepSection[] = []
  let current: LogStepSection | null = null

  for (const line of logText.split('\n')) {
    const match = line.match(/^=== (.+?) \(exit (\d+)\)$/)
    if (match) {
      if (current) sections.push(current)
      current = {
        name: match[1],
        exitCode: Number(match[2]),
        text: '',
      }
      continue
    }

    if (current) {
      current.text += `${current.text ? '\n' : ''}${line}`
    }
  }

  if (current) sections.push(current)
  return sections
}

export function stepDisplayStatus(
  exitCode: number | undefined,
  jobStatus: JobRun['status'],
): JobRun['status'] | 'pending' {
  if (exitCode !== undefined) {
    return exitCode === 0 ? 'success' : 'failure'
  }
  if (jobStatus === 'running') return 'running'
  if (jobStatus === 'queued') return 'queued'
  return 'pending'
}

export function jobStepViews(job: JobRun): JobStepView[] {
  const fromMetrics = job.metrics_json?.steps ?? []
  if (fromMetrics.length > 0) {
    return fromMetrics.map((step) => ({
      key: step.name,
      name: step.name,
      exitCode: step.exit_code,
      durationMs: step.duration_ms,
    }))
  }

  const fromLog = parseLogSteps(job.log_text)
  if (fromLog.length > 0) {
    return fromLog.map((step) => ({
      key: step.name,
      name: step.name,
      exitCode: step.exitCode ?? undefined,
    }))
  }

  return job.steps.map((step, index) => ({
    key: step.name || `step-${index + 1}`,
    name: step.name || `step-${index + 1}`,
    run: step.run,
  }))
}

export function stepLogText(job: JobRun, stepKey: string | null): string {
  if (!stepKey) return job.log_text

  const section = parseLogSteps(job.log_text).find((step) => step.name === stepKey)
  if (section) {
    const header = `=== ${section.name} (exit ${section.exitCode ?? '?'})`
    return section.text.trim() ? `${header}\n${section.text.trim()}` : header
  }

  const step = jobStepViews(job).find((item) => item.key === stepKey)
  if (step?.run) {
    return `$ ${step.run}\n\n(step has not run yet)`
  }

  return '(no output for this step)'
}

export function stepMeta(step: JobStepView): string {
  if (step.durationMs !== undefined) return `${step.durationMs}ms`
  if (step.exitCode !== undefined) return `exit ${step.exitCode}`
  return step.run ? step.run.slice(0, 48) : ''
}
