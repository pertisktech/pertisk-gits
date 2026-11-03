function imgAttrsToMarkdown(attrs: string): string {
  const srcMatch =
    attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i) ?? attrs.match(/\bsrc\s*=\s*([^\s>]+)/i)
  if (!srcMatch) return ''
  const altMatch = attrs.match(/\balt\s*=\s*["']([^"']*)["']/i)
  const alt = altMatch?.[1] ?? ''
  return `![${alt}](${srcMatch[1]})`
}

/** Strip HTML comments so they are not shown as visible text (react-markdown does not hide them). */
export function stripHtmlComments(content: string): string {
  return content.replace(/<!--[\s\S]*?-->/g, '')
}

/** Convert HTML `<img>` tags (common in READMEs) into markdown images for rendering. */
export function preprocessRepoMarkdownHtmlImages(content: string): string {
  let result = stripHtmlComments(content)

  result = result.replace(
    /<p[^>]*>\s*<img\b([^>]*?)\/?>\s*<\/p>/gi,
    (_, attrs: string) => imgAttrsToMarkdown(attrs),
  )

  result = result.replace(/<img\b([^>]*?)\/?>/gi, (_, attrs: string) => imgAttrsToMarkdown(attrs))

  return result
}
