import CodeEditor from '@uiw/react-textarea-code-editor'
import '@uiw/react-textarea-code-editor/dist.css'
import { useTheme } from '../context/ThemeContext'
import { languageFromPath } from '../lib/fileLanguage'

interface CodeFileViewProps {
  path: string
  content: string
}

export function CodeFileView({ path, content }: CodeFileViewProps) {
  const { theme } = useTheme()

  return (
    <div className="app-code-view">
      <CodeEditor
        value={content}
        language={languageFromPath(path)}
        data-color-mode={theme}
        readOnly
        padding={12}
        onChange={() => undefined}
        style={{
          fontSize: 12,
          fontFamily: 'var(--font-mono)',
          backgroundColor: 'var(--color-bg)',
          color: 'var(--color-text)',
        }}
      />
    </div>
  )
}
