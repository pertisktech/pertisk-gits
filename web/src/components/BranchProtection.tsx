import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Shield, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../api/client'
import type { BranchProtectionRule } from '../api/types'
import { PrimaryButton, SecondaryButton } from './ui'

interface BranchProtectionProps {
  token: string
  orgSlug: string
  repoSlug: string
  branchOptions: string[]
}

export function BranchProtection({
  token,
  orgSlug,
  repoSlug,
  branchOptions,
}: BranchProtectionProps) {
  const queryClient = useQueryClient()
  const [branchPattern, setBranchPattern] = useState(branchOptions[0] ?? 'main')
  const [requiredApprovals, setRequiredApprovals] = useState(1)
  const [requirePullRequest, setRequirePullRequest] = useState(true)
  const [requireStatusChecks, setRequireStatusChecks] = useState(false)
  const [allowForcePush, setAllowForcePush] = useState(false)
  const [allowAdminBypass, setAllowAdminBypass] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { data: rules = [], isLoading, isError } = useQuery({
    queryKey: ['branch-protection', orgSlug, repoSlug],
    queryFn: () => api.listBranchProtectionRules(token, orgSlug, repoSlug),
    enabled: Boolean(token),
    retry: false,
  })

  const createRule = useMutation({
    mutationFn: () =>
      api.createBranchProtectionRule(token, orgSlug, repoSlug, {
        branch_pattern: branchPattern.trim(),
        require_pull_request: requirePullRequest,
        required_approvals: requiredApprovals,
        require_status_checks: requireStatusChecks,
        allow_force_push: allowForcePush,
        allow_admin_bypass: allowAdminBypass,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branch-protection', orgSlug, repoSlug] })
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const updateRule = useMutation({
    mutationFn: ({
      ruleId,
      payload,
    }: {
      ruleId: string
      payload: Partial<BranchProtectionRule>
    }) =>
      api.updateBranchProtectionRule(token, orgSlug, repoSlug, ruleId, {
        require_pull_request: payload.require_pull_request,
        required_approvals: payload.required_approvals,
        require_status_checks: payload.require_status_checks,
        allow_force_push: payload.allow_force_push,
        allow_admin_bypass: payload.allow_admin_bypass,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branch-protection', orgSlug, repoSlug] })
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const removeRule = useMutation({
    mutationFn: (ruleId: string) =>
      api.removeBranchProtectionRule(token, orgSlug, repoSlug, ruleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branch-protection', orgSlug, repoSlug] })
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  if (isError) {
    return null
  }

  function onCreate(event: FormEvent) {
    event.preventDefault()
    if (!branchPattern.trim()) {
      setError('Branch pattern is required')
      return
    }
    setError(null)
    createRule.mutate()
  }

  return (
    <div className="app-panel max-w-2xl">
      <div className="app-panel-header flex items-center gap-2">
        <Shield size={16} />
        Branch protection
      </div>
      <div className="app-panel-body space-y-5">
        <p className="text-sm text-text-secondary">
          Protect branches from direct pushes and enforce reviews or CI before merge. Use{' '}
          <code className="text-xs">*</code> wildcards (e.g. <code className="text-xs">release/*</code>
          ).
        </p>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 size={14} className="animate-spin" />
            Loading rules…
          </div>
        ) : rules.length > 0 ? (
          <ul className="space-y-3">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className="rounded-md border border-border p-3 space-y-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-text">{rule.branch_pattern}</span>
                  <SecondaryButton
                    type="button"
                    onClick={() => removeRule.mutate(rule.id)}
                    disabled={removeRule.isPending}
                  >
                    <Trash2 size={14} />
                    Remove
                  </SecondaryButton>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={rule.require_pull_request}
                      onChange={(e) =>
                        updateRule.mutate({
                          ruleId: rule.id,
                          payload: { require_pull_request: e.target.checked },
                        })
                      }
                    />
                    Require pull request
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={rule.require_status_checks}
                      onChange={(e) =>
                        updateRule.mutate({
                          ruleId: rule.id,
                          payload: { require_status_checks: e.target.checked },
                        })
                      }
                    />
                    Require CI checks
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={rule.allow_force_push}
                      onChange={(e) =>
                        updateRule.mutate({
                          ruleId: rule.id,
                          payload: { allow_force_push: e.target.checked },
                        })
                      }
                    />
                    Allow force push
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={rule.allow_admin_bypass}
                      onChange={(e) =>
                        updateRule.mutate({
                          ruleId: rule.id,
                          payload: { allow_admin_bypass: e.target.checked },
                        })
                      }
                    />
                    Admin bypass
                  </label>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  Required approvals
                  <input
                    type="number"
                    min={0}
                    max={20}
                    className="app-field w-20"
                    value={rule.required_approvals}
                    onChange={(e) =>
                      updateRule.mutate({
                        ruleId: rule.id,
                        payload: { required_approvals: Number(e.target.value) },
                      })
                    }
                  />
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text-secondary">No branch protection rules yet.</p>
        )}

        <form className="space-y-3 border-t border-border pt-4" onSubmit={onCreate}>
          <p className="text-sm font-medium text-text">Add rule</p>
          <div className="space-y-2">
            <label htmlFor="branch-pattern" className="text-sm text-text-secondary">
              Branch pattern
            </label>
            <input
              id="branch-pattern"
              className="app-field"
              list="branch-pattern-options"
              value={branchPattern}
              onChange={(e) => setBranchPattern(e.target.value)}
              placeholder="main or release/*"
              required
            />
            <datalist id="branch-pattern-options">
              {branchOptions.map((branch) => (
                <option key={branch} value={branch} />
              ))}
            </datalist>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={requirePullRequest}
                onChange={(e) => setRequirePullRequest(e.target.checked)}
              />
              Require pull request
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={requireStatusChecks}
                onChange={(e) => setRequireStatusChecks(e.target.checked)}
              />
              Require CI checks
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={allowForcePush}
                onChange={(e) => setAllowForcePush(e.target.checked)}
              />
              Allow force push
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={allowAdminBypass}
                onChange={(e) => setAllowAdminBypass(e.target.checked)}
              />
              Admin bypass
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            Required approvals
            <input
              type="number"
              min={0}
              max={20}
              className="app-field w-20"
              value={requiredApprovals}
              onChange={(e) => setRequiredApprovals(Number(e.target.value))}
            />
          </label>
          {error && (
            <div className="p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
              {error}
            </div>
          )}
          <PrimaryButton type="submit" disabled={createRule.isPending}>
            {createRule.isPending ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Adding…
              </>
            ) : (
              'Add protection rule'
            )}
          </PrimaryButton>
        </form>
      </div>
    </div>
  )
}
