import CodeEditor from '@uiw/react-textarea-code-editor'
import '@uiw/react-textarea-code-editor/dist.css'
import { useTheme } from '../context/ThemeContext'
import { languageFromPath } from '../lib/fileLanguage'

interface CodeFileViewProps {
  path: string
  content: string
  readOnly?: boolean
  onChange?: (value: string) => void
}

export function CodeFileView({ path, content, readOnly = true, onChange }: CodeFileViewProps) {
  const { theme } = useTheme()

  return (
    <div className={readOnly ? 'app-code-view' : 'app-code-view app-code-view--editable'}>
      <CodeEditor
        value={content}
        language={languageFromPath(path)}
        data-color-mode={theme}
        readOnly={readOnly}
        padding={12}
        onChange={(event) => onChange?.(event.target.value)}
        style={{
          fontSize: 12,
          fontFamily: 'var(--font-mono)',
          backgroundColor: 'var(--color-bg)',
          color: 'var(--color-text)',
          minHeight: readOnly ? undefined : '100%',
        }}
      />
    </div>
  )
}
