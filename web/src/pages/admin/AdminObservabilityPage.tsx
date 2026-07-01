import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, ExternalLink, Loader2 } from 'lucide-react'
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { api } from '../../api/client'
import type { ObservabilitySettings } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { InfoPanel, InfoRow } from '../../components/AdminInfoPanel'
import { Breadcrumbs, Checkbox, PageHeader, PrimaryButton, SecondaryButton } from '../../components/ui'

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error'] as const

type FormState = {
  http_logging_enabled: boolean
  error_logging_enabled: boolean
  log_level: string
  prometheus_enabled: boolean
}

function toForm(settings: ObservabilitySettings): FormState {
  return {
    http_logging_enabled: settings.http_logging_enabled,
    error_logging_enabled: settings.error_logging_enabled,
    log_level: settings.log_level,
    prometheus_enabled: settings.prometheus_enabled,
  }
}

export function AdminObservabilityPage() {
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [metricsPreview, setMetricsPreview] = useState<string | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-observability'],
    queryFn: () => api.getObservabilitySettings(token!),
    enabled: Boolean(token),
  })

  useEffect(() => {
    if (data && !form) {
      setForm(toForm(data))
    }
  }, [data, form])

  const saveMutation = useMutation({
    mutationFn: (payload: FormState) => api.updateObservabilitySettings(token!, payload),
    onSuccess: (updated) => {
      queryClient.setQueryData(['admin-observability'], updated)
      setForm(toForm(updated))
      setSuccess('Observability settings saved.')
      setError(null)
    },
    onError: (err: Error) => {
      setSuccess(null)
      setError(err.message)
    },
  })

  async function handleViewMetrics() {
    if (!token) return
    setMetricsLoading(true)
    setMetricsPreview(null)
    try {
      const body = await api.getAdminMetrics(token)
      setMetricsPreview(body)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setMetricsLoading(false)
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!form) return
    setSuccess(null)
    setError(null)
    saveMutation.mutate(form)
  }

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Admin', to: '/admin' },
          { label: 'Logging & metrics' },
        ]}
      />
      <PageHeader
        title="Logging & metrics"
        subtitle="HTTP request logging, API error logging, log levels, and Prometheus metrics."
      />

      {isLoading && (
        <div className="flex items-center gap-2 text-text-secondary text-sm py-8">
          <Loader2 size={16} className="animate-spin" />
          Loading observability settings…
        </div>
      )}

      {data && form && (
        <form onSubmit={handleSubmit} className="space-y-4 max-w-3xl">
          {error && (
            <div className="p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
              {error}
            </div>
          )}
          {success && (
            <div className="p-3 rounded-lg border border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400 text-sm">
              {success}
            </div>
          )}

          <InfoPanel title="HTTP logging">
            <div className="space-y-3 px-4 py-3">
              <Checkbox
                label="Log HTTP requests"
                checked={form.http_logging_enabled}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setForm((prev) => prev && { ...prev, http_logging_enabled: e.target.checked })
                }
              />
              <p className="text-text-secondary text-xs">
                Writes one structured log line per request with method, path, status, and duration.
              </p>
            </div>
          </InfoPanel>

          <InfoPanel title="Error logging">
            <div className="space-y-3 px-4 py-3">
              <Checkbox
                label="Log API and HTTP errors"
                checked={form.error_logging_enabled}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setForm((prev) => prev && { ...prev, error_logging_enabled: e.target.checked })
                }
              />
              <p className="text-text-secondary text-xs">
                Client errors (4xx) are logged at warn; server errors (5xx) and API failures at error.
              </p>
            </div>
          </InfoPanel>

          <InfoPanel title="Log level">
            <div className="space-y-3 px-4 py-3">
              <label className="block text-sm text-text-secondary">
                Application log level
                <select
                  className="mt-1 block w-full max-w-xs rounded-md border border-border bg-surface px-3 py-2 text-sm"
                  value={form.log_level}
                  disabled={!data.log_level_managed}
                  onChange={(e) =>
                    setForm((prev) => prev && { ...prev, log_level: e.target.value })
                  }
                >
                  {LOG_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </label>
              {data.rust_log_env ? (
                <p className="text-amber-600 dark:text-amber-400 text-xs">
                  <code>RUST_LOG={data.rust_log_env}</code> is set in the environment and overrides the
                  admin log level until it is removed.
                </p>
              ) : (
                <p className="text-text-secondary text-xs">
                  Applies to <code>pertisk_api</code> tracing output at runtime.
                </p>
              )}
            </div>
          </InfoPanel>

          <InfoPanel title="Prometheus metrics">
            <div className="space-y-3 px-4 py-3">
              <Checkbox
                label="Enable Prometheus metrics"
                checked={form.prometheus_enabled}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setForm((prev) => prev && { ...prev, prometheus_enabled: e.target.checked })
                }
              />
              <InfoRow
                label="Scrape endpoint"
                value={
                  <code className="text-xs">GET /api/v1/admin/metrics</code>
                }
              />
              <p className="text-text-secondary text-xs">
                Requires super-admin authentication. Exposes{' '}
                <code>pertisk_http_requests_total</code> and{' '}
                <code>pertisk_http_request_duration_seconds</code>.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <SecondaryButton
                  type="button"
                  onClick={handleViewMetrics}
                  disabled={!form.prometheus_enabled || metricsLoading}
                >
                  {metricsLoading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Activity size={14} />
                  )}
                  Preview metrics
                </SecondaryButton>
              </div>
              {metricsPreview && (
                <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-border bg-surface-elevated p-3 text-xs font-mono whitespace-pre-wrap">
                  {metricsPreview}
                </pre>
              )}
            </div>
          </InfoPanel>

          <div className="flex gap-2">
            <PrimaryButton type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Saving…
                </>
              ) : (
                'Save settings'
              )}
            </PrimaryButton>
            <SecondaryButton
              type="button"
              onClick={() => data && setForm(toForm(data))}
              disabled={saveMutation.isPending}
            >
              Reset
            </SecondaryButton>
          </div>
        </form>
      )}

      {data && (
        <div className="mt-6 max-w-3xl text-text-secondary text-xs">
          <p className="flex items-center gap-1">
            <ExternalLink size={12} />
            Prometheus scrapers should use a bearer token from a super-admin account.
          </p>
        </div>
      )}
    </>
  )
}
