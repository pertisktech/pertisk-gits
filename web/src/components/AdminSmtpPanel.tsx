import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Mail } from 'lucide-react'
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { api } from '../api/client'
import type { SmtpSettings } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { Checkbox, PrimaryButton, SecondaryButton } from './ui'

type FormState = {
  enabled: boolean
  host: string
  port: string
  username: string
  password: string
  from_email: string
  from_name: string
  use_tls: boolean
  notify_login: boolean
  notify_user_registration: boolean
  notify_user_approval: boolean
  notify_merge_request: boolean
  notify_pipeline_failure: boolean
}

function toForm(settings: SmtpSettings): FormState {
  return {
    enabled: settings.enabled,
    host: settings.host,
    port: String(settings.port),
    username: settings.username ?? '',
    password: '',
    from_email: settings.from_email,
    from_name: settings.from_name,
    use_tls: settings.use_tls,
    notify_login: settings.notify_login,
    notify_user_registration: settings.notify_user_registration,
    notify_user_approval: settings.notify_user_approval,
    notify_merge_request: settings.notify_merge_request,
    notify_pipeline_failure: settings.notify_pipeline_failure,
  }
}

export function AdminSmtpPanel() {
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-smtp-settings'],
    queryFn: () => api.getSmtpSettings(token!),
    enabled: Boolean(token),
  })

  useEffect(() => {
    if (data && !form) {
      setForm(toForm(data))
    }
  }, [data, form])

  const save = useMutation({
    mutationFn: () => {
      const port = Number.parseInt(form!.port, 10)
      const payload = {
        enabled: form!.enabled,
        host: form!.host,
        port: Number.isFinite(port) ? port : 587,
        username: form!.username,
        from_email: form!.from_email,
        from_name: form!.from_name,
        use_tls: form!.use_tls,
        notify_login: form!.notify_login,
        notify_user_registration: form!.notify_user_registration,
        notify_user_approval: form!.notify_user_approval,
        notify_merge_request: form!.notify_merge_request,
        notify_pipeline_failure: form!.notify_pipeline_failure,
        ...(form!.password ? { password: form!.password } : {}),
      }
      return api.updateSmtpSettings(token!, payload)
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(['admin-smtp-settings'], settings)
      setForm(toForm(settings))
      setError(null)
      setSuccess('SMTP settings saved.')
    },
    onError: (err: Error) => {
      setSuccess(null)
      setError(err.message)
    },
  })

  const test = useMutation({
    mutationFn: async () => {
      const port = Number.parseInt(form!.port, 10)
      await api.updateSmtpSettings(token!, {
        enabled: form!.enabled,
        host: form!.host,
        port: Number.isFinite(port) ? port : 587,
        username: form!.username,
        from_email: form!.from_email,
        from_name: form!.from_name,
        use_tls: form!.use_tls,
        ...(form!.password ? { password: form!.password } : {}),
      })
      return api.testSmtpSettings(token!)
    },
    onSuccess: (result: { ok: boolean; to: string }) => {
      queryClient.invalidateQueries({ queryKey: ['admin-smtp-settings'] })
      setError(null)
      setSuccess(`Test email sent to ${result.to}.`)
    },
    onError: (err: Error) => {
      setSuccess(null)
      setError(err.message)
    },
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSuccess(null)
    save.mutate()
  }

  return (
    <div className="app-panel max-w-3xl">
      <div className="app-panel-header flex items-center gap-2">
        <Mail size={16} />
        Email notifications (SMTP)
      </div>

      {isLoading && (
        <div className="app-panel-body flex items-center gap-2 text-text-secondary text-sm">
          <Loader2 size={16} className="animate-spin" />
          Loading SMTP settings…
        </div>
      )}

      {form && (
        <form className="app-panel-body space-y-4" onSubmit={onSubmit}>
          {!form.enabled && (
            <div className="p-3 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200 text-sm">
              SMTP is <strong>disabled</strong>. Notification emails will not send until you check
              &quot;Enable SMTP&quot; and save. You can still use &quot;Send test email&quot; to verify
              your configuration.
            </div>
          )}
          {error && (
            <div className="p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
              {error}
            </div>
          )}
          {success && (
            <div className="p-3 rounded-md border border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300 text-sm">
              {success}
            </div>
          )}

          <Checkbox
            label="Enable SMTP"
            checked={form.enabled}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, enabled: e.target.checked })}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm sm:col-span-2">
              SMTP host
              <input
                className="app-field mt-1"
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
                placeholder="smtp.example.com"
              />
            </label>
            <label className="text-sm">
              Port
              <input
                className="app-field mt-1"
                type="number"
                min={1}
                max={65535}
                value={form.port}
                onChange={(e) => setForm({ ...form, port: e.target.value })}
              />
            </label>
            <label className="text-sm flex items-end pb-2">
              <Checkbox
                label="Use TLS"
                checked={form.use_tls}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, use_tls: e.target.checked })}
              />
            </label>
            <label className="text-sm">
              Username
              <input
                className="app-field mt-1"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                autoComplete="off"
              />
            </label>
            <label className="text-sm">
              Password
              <input
                className="app-field mt-1"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={data?.has_password ? '•••••••• (unchanged)' : ''}
                autoComplete="new-password"
              />
            </label>
            <label className="text-sm">
              From email
              <input
                className="app-field mt-1"
                type="email"
                value={form.from_email}
                onChange={(e) => setForm({ ...form, from_email: e.target.value })}
                placeholder="noreply@example.com"
              />
              {form.host.includes('gmail.com') && form.username && form.from_email !== form.username && (
                <span className="block mt-1 text-xs text-amber-700 dark:text-amber-300">
                  Gmail usually requires the from address to match your SMTP username or a verified alias.
                </span>
              )}
            </label>
            <label className="text-sm">
              From name
              <input
                className="app-field mt-1"
                value={form.from_name}
                onChange={(e) => setForm({ ...form, from_name: e.target.value })}
              />
            </label>
          </div>

          <div className="border-t border-border pt-4">
            <p className="text-sm font-medium text-text-primary mb-3">Notify on</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Checkbox
                row
                label="User login"
                description="Password, SSO, LDAP"
                checked={form.notify_login}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, notify_login: e.target.checked })}
              />
              <Checkbox
                row
                label="User registration"
                description="Welcome email; admins when approval required"
                checked={form.notify_user_registration}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, notify_user_registration: e.target.checked })}
              />
              <Checkbox
                row
                label="User approved"
                description="When admin approves an account"
                checked={form.notify_user_approval}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, notify_user_approval: e.target.checked })}
              />
              <Checkbox
                row
                label="Merge requests"
                description="Opened and merged"
                checked={form.notify_merge_request}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, notify_merge_request: e.target.checked })}
              />
              <Checkbox
                row
                label="CI/CD pipeline failure"
                checked={form.notify_pipeline_failure}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, notify_pipeline_failure: e.target.checked })}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <PrimaryButton type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save SMTP settings'}
            </PrimaryButton>
            <SecondaryButton
              type="button"
              onClick={() => test.mutate()}
              disabled={test.isPending || !form.host.trim() || !form.from_email.trim()}
            >
              {test.isPending ? 'Sending…' : 'Send test email'}
            </SecondaryButton>
          </div>
        </form>
      )}
    </div>
  )
}
