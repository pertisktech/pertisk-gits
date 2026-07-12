import { ArrowDown, ChevronRight, Terminal } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PipelineStatusDot } from './PipelineStatus'
import { cn } from '../utils/cn'

const SCROLL_BOTTOM_THRESHOLD_PX = 48

export function CiTerminal({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <div className={cn('ci-terminal', className)}>
      <div className="ci-terminal-chrome">
        <div className="ci-terminal-lights" aria-hidden>
          <span className="ci-terminal-light ci-terminal-light-red" />
          <span className="ci-terminal-light ci-terminal-light-yellow" />
          <span className="ci-terminal-light ci-terminal-light-green" />
        </div>
        <div className="ci-terminal-title">
          <Terminal size={12} className="opacity-70" />
          <span className="truncate">{title}</span>
          {subtitle && <span className="ci-terminal-subtitle truncate">{subtitle}</span>}
        </div>
        {actions && <div className="ci-terminal-actions">{actions}</div>}
      </div>
      <div className={cn('ci-terminal-body', bodyClassName)}>{children}</div>
    </div>
  )
}

export function CiPrompt({
  user = 'runner',
  host = 'pertisk-ci',
  path,
  command,
  className,
}: {
  user?: string
  host?: string
  path?: string
  command?: string
  className?: string
}) {
  return (
    <div className={cn('ci-terminal-prompt', className)}>
      <span className="ci-terminal-prompt-user">{user}</span>
      <span className="ci-terminal-prompt-at">@</span>
      <span className="ci-terminal-prompt-host">{host}</span>
      {path && (
        <>
          <span className="ci-terminal-prompt-colon">:</span>
          <span className="ci-terminal-prompt-path">{path}</span>
        </>
      )}
      <span className="ci-terminal-prompt-bang">$</span>
      {command && <span className="ci-terminal-prompt-cmd">{command}</span>}
    </div>
  )
}

function lineClass(line: string) {
  const trimmed = line.trim()
  if (!trimmed) return 'ci-log-line'
  if (trimmed.startsWith('===')) {
    return /\(exit [1-9]\d*\)/.test(trimmed)
      ? 'ci-log-line ci-log-line-step ci-log-line-step-fail'
      : 'ci-log-line ci-log-line-step ci-log-line-step-ok'
  }
  if (
    /^(error|fatal|npm error|checkout failed|permission denied)/i.test(trimmed) ||
    trimmed.includes(' EACCES ') ||
    trimmed.includes(' ENOENT ')
  ) {
    return 'ci-log-line ci-log-line-error'
  }
  if (/^(warn|warning|npm warn)/i.test(trimmed)) {
    return 'ci-log-line ci-log-line-warn'
  }
  if (/^(✓|success|passed|done)/i.test(trimmed)) {
    return 'ci-log-line ci-log-line-ok'
  }
  return 'ci-log-line'
}

function isNearBottom(element: HTMLElement) {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <=
    SCROLL_BOTTOM_THRESHOLD_PX
  )
}

export function CiLogViewer({
  text,
  emptyMessage = '(waiting for output…)',
  className,
  maxHeight,
  followTail = false,
}: {
  text: string
  emptyMessage?: string
  className?: string
  maxHeight?: string
  /** When true, stick to the bottom while streaming until the user scrolls up. */
  followTail?: boolean
}) {
  const trimmed = text.trim()
  const lines = trimmed ? trimmed.split('\n') : []
  const lineNumWidth = Math.max(2, String(lines.length || 1).length)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [isFollowing, setIsFollowing] = useState(followTail)
  const isFollowingRef = useRef(isFollowing)

  useEffect(() => {
    isFollowingRef.current = isFollowing
  }, [isFollowing])

  const scrollToBottom = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    element.scrollTop = element.scrollHeight
  }, [])

  useEffect(() => {
    setIsFollowing(followTail)
    isFollowingRef.current = followTail
  }, [followTail])

  useLayoutEffect(() => {
    if (!followTail || !isFollowingRef.current) return
    scrollToBottom()
    const frame = requestAnimationFrame(scrollToBottom)
    return () => cancelAnimationFrame(frame)
  }, [followTail, isFollowing, text, scrollToBottom])

  useEffect(() => {
    if (!followTail) return
    const content = contentRef.current
    if (!content || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      if (isFollowingRef.current) {
        scrollToBottom()
      }
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [followTail, scrollToBottom])

  const handleScroll = useCallback(() => {
    if (!followTail) return
    const element = scrollRef.current
    if (!element) return
    const next = isNearBottom(element)
    isFollowingRef.current = next
    setIsFollowing(next)
  }, [followTail])

  const resumeFollowing = useCallback(() => {
    isFollowingRef.current = true
    setIsFollowing(true)
    scrollToBottom()
    requestAnimationFrame(scrollToBottom)
  }, [scrollToBottom])

  return (
    <div className="ci-log-viewer-shell">
      <div
        ref={scrollRef}
        className={cn('ci-log-viewer', className)}
        style={maxHeight ? { maxHeight } : undefined}
        onScroll={handleScroll}
      >
        <div ref={contentRef}>
          {lines.length === 0 ? (
            <div className="ci-log-line ci-log-line-muted">{emptyMessage}</div>
          ) : (
            lines.map((line, index) => (
              <div key={`${index}-${line.slice(0, 24)}`} className="ci-log-row">
                <span
                  className="ci-log-line-num"
                  style={{ minWidth: `${lineNumWidth + 0.5}ch` }}
                  aria-hidden
                >
                  {index + 1}
                </span>
                <span className={lineClass(line)}>{line || '\u00a0'}</span>
              </div>
            ))
          )}
        </div>
      </div>
      {followTail && !isFollowing && (
        <div className="ci-log-follow-row">
          <button
            type="button"
            className="ci-log-follow-button"
            onClick={resumeFollowing}
          >
            <ArrowDown size={14} aria-hidden />
            Jump to latest
          </button>
        </div>
      )}
    </div>
  )
}

export function CiStatusDot({ status }: { status: string }) {
  return <PipelineStatusDot status={status} />
}

export function CiRunLine({
  status,
  label,
  meta,
  hint,
  onClick,
  active,
  nested,
}: {
  status: string
  label: string
  meta: string
  hint?: string
  onClick?: () => void
  active?: boolean
  nested?: boolean
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'ci-run-line',
        nested && 'ci-run-line-nested',
        active && 'ci-run-line-active',
        onClick && 'ci-run-line-clickable',
      )}
    >
      <CiStatusDot status={status} />
      <span className="ci-run-line-label">{label}</span>
      <span className="ci-run-line-meta">{meta}</span>
      {hint && <span className="ci-run-line-hint truncate">{hint}</span>}
      {onClick && <ChevronRight size={14} className="ci-run-line-chevron shrink-0" />}
    </Tag>
  )
}
