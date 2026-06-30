import CodeEditor from '@uiw/react-textarea-code-editor'
import '@uiw/react-textarea-code-editor/dist.css'
import { useMemo, useRef } from 'react'
import { useTheme } from '../context/ThemeContext'
import { languageFromPath } from '../lib/fileLanguage'

const EDITOR_PADDING = 12
const EDITOR_FONT_SIZE = 'var(--text-code)'
const EDITOR_LINE_HEIGHT = 1.5

interface CodeFileViewProps {
  path: string
  content: string
  readOnly?: boolean
  onChange?: (value: string) => void
}

function lineCountFor(content: string): number {
  if (content.length === 0) return 1
  return content.split('\n').length
}

export function CodeFileView({ path, content, readOnly = true, onChange }: CodeFileViewProps) {
  const { theme } = useTheme()
  const scrollRef = useRef<HTMLDivElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)

  const lineCount = useMemo(() => lineCountFor(content), [content])
  const lineNumbers = useMemo(
    () => Array.from({ length: lineCount }, (_, index) => index + 1),
    [lineCount],
  )

  function syncGutterScroll() {
    if (scrollRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = scrollRef.current.scrollTop
    }
  }

  return (
    <div className="app-code-view-shell">
      <div
        ref={gutterRef}
        className="app-code-line-gutter"
        aria-hidden
        style={{ paddingTop: EDITOR_PADDING, paddingBottom: EDITOR_PADDING }}
      >
        {lineNumbers.map((number) => (
          <span key={number} className="app-code-line-num">
            {number}
          </span>
        ))}
      </div>

      <div
        ref={scrollRef}
        className={readOnly ? 'app-code-view' : 'app-code-view app-code-view--editable'}
        onScroll={syncGutterScroll}
      >
        <CodeEditor
          value={content}
          language={languageFromPath(path)}
          data-color-mode={theme}
          readOnly={readOnly}
          padding={EDITOR_PADDING}
          onChange={(event) => onChange?.(event.target.value)}
          style={{
            fontSize: EDITOR_FONT_SIZE,
            fontFamily: 'var(--font-mono)',
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text)',
            minHeight: readOnly ? undefined : '100%',
            lineHeight: EDITOR_LINE_HEIGHT,
          }}
        />
      </div>
    </div>
  )
}
