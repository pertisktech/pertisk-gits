import type { JobRun, PipelineRun } from '../api/types'

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
  running?: boolean
}

export function parseLogSteps(logText: string): LogStepSection[] {
  const sections: LogStepSection[] = []
  let current: LogStepSection | null = null

  for (const line of logText.split('\n')) {
    const exitMatch = line.match(/^=== (.+?) \(exit (\d+|cancelled)\)$/)
    const runningMatch = line.match(/^=== (.+?) \(running\)$/)

    if (runningMatch) {
      if (current) sections.push(current)
      current = {
        name: runningMatch[1],
        exitCode: null,
        text: '',
      }
      continue
    }

    if (exitMatch) {
      const name = exitMatch[1]
      const exitCode = exitMatch[2] === 'cancelled' ? 130 : Number(exitMatch[2])
      if (current && current.name === name && current.exitCode === null) {
        current.exitCode = exitCode
        continue
      }
      if (current) sections.push(current)
      current = {
        name,
        exitCode,
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
  step: JobStepView,
  jobStatus: JobRun['status'],
  runStatus?: PipelineRun['status'],
): JobRun['status'] | 'pending' {
  if (step.exitCode !== undefined) {
    if (step.exitCode === 130) return 'cancelled'
    return step.exitCode === 0 ? 'success' : 'failure'
  }
  if (jobStatus === 'cancelled' || runStatus === 'cancelled') return 'cancelled'
  if (step.running) return 'running'
  if (jobStatus === 'running') return 'pending'
  if (jobStatus === 'queued') return 'queued'
  return 'pending'
}

function effectiveJobStatus(
  job: JobRun,
  runStatus?: PipelineRun['status'],
): JobRun['status'] {
  if (
    runStatus === 'cancelled' &&
    (job.status === 'running' || job.status === 'queued')
  ) {
    return 'cancelled'
  }
  return job.status
}

export function jobStepViews(job: JobRun, runStatus?: PipelineRun['status']): JobStepView[] {
  const configured = job.steps.map((step, index) => ({
    key: step.name || `step-${index + 1}`,
    name: step.name || `step-${index + 1}`,
    run: step.run,
  }))

  const fromMetrics = job.metrics_json?.steps ?? []
  if (fromMetrics.length > 0) {
    return fromMetrics.map((step) => ({
      key: step.name,
      name: step.name,
      exitCode: step.exit_code,
      durationMs: step.duration_ms,
    }))
  }

  const logSteps = parseLogSteps(job.log_text)
  const jobStatus = effectiveJobStatus(job, runStatus)
  if (configured.length > 0) {
    const nextIndex = inferNextStepIndex(
      logSteps,
      configured.map((step) => ({ name: step.name })),
    )
    return configured.map((step, index) => {
      const log = logSteps.find((entry) => entry.name === step.name)
      let exitCode = log?.exitCode ?? undefined
      if (exitCode === null) {
        exitCode = undefined
      }
      const running =
        jobStatus === 'running' &&
        (log?.exitCode === null || (exitCode === undefined && index === nextIndex))
      return {
        ...step,
        exitCode: running ? undefined : exitCode,
        running,
      }
    })
  }

  if (logSteps.length > 0) {
    return logSteps.map((step) => ({
      key: step.name,
      name: step.name,
      exitCode: step.exitCode ?? undefined,
    }))
  }

  return configured
}

function inferNextStepIndex(
  logSteps: LogStepSection[],
  configured: Array<{ name: string }>,
): number {
  for (let index = 0; index < configured.length; index += 1) {
    const log = logSteps.find((entry) => entry.name === configured[index].name)
    if (!log || log.exitCode === null) {
      return index
    }
    if (log.exitCode !== 0) {
      return index
    }
  }
  return configured.length
}

export function inferRunningStepName(
  job: JobRun,
  runStatus?: PipelineRun['status'],
): string | null {
  if (effectiveJobStatus(job, runStatus) !== 'running') {
    return null
  }

  const configured = job.steps
    .map((step, index) => step.name || `step-${index + 1}`)
    .filter(Boolean)
  if (configured.length === 0) {
    return null
  }

  const logSteps = parseLogSteps(job.log_text)
  const running = logSteps.find((step) => step.exitCode === null)
  if (running) {
    return running.name
  }

  const nextIndex = inferNextStepIndex(
    logSteps,
    configured.map((name) => ({ name })),
  )
  return configured[nextIndex] ?? null
}

export function formatRunPreview(run: string): string {
  return run
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `$ ${line}`)
    .join('\n')
}

export function stepLogText(
  job: JobRun,
  stepKey: string | null,
  runStatus?: PipelineRun['status'],
): string {
  if (!stepKey) return job.log_text

  const section = parseLogSteps(job.log_text).find((step) => step.name === stepKey)
  if (section) {
    const header =
      section.exitCode === null
        ? `=== ${section.name} (running)`
        : section.exitCode === 130
          ? `=== ${section.name} (exit cancelled)`
          : `=== ${section.name} (exit ${section.exitCode})`
    return section.text.trim() ? `${header}\n${section.text.trim()}` : header
  }

  if (
    effectiveJobStatus(job, runStatus) === 'running' &&
    inferRunningStepName(job, runStatus) === stepKey
  ) {
    return job.log_text.trim()
      ? `${job.log_text.trim()}\n\n=== ${stepKey} (starting…)`
      : `=== ${stepKey} (starting…)`
  }

  const step = jobStepViews(job, runStatus).find((item) => item.key === stepKey)
  if (step?.run) {
    return `${formatRunPreview(step.run)}\n\n(step has not run yet)`
  }

  return '(no output for this step)'
}

export function stepMeta(step: JobStepView): string {
  if (step.durationMs !== undefined) return `${step.durationMs}ms`
  if (step.exitCode !== undefined) return `exit ${step.exitCode}`
  return step.run ? step.run.slice(0, 48) : ''
}
