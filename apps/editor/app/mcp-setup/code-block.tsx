import { CopyButton } from './copy-button'

export function CodeBlock({
  code,
  label,
  language = 'text',
}: {
  code: string
  label: string
  language?: string
}) {
  return (
    <figure className="overflow-hidden rounded-lg border border-border bg-foreground text-background">
      <figcaption className="flex items-center justify-between gap-4 border-background/15 border-b px-4 py-2">
        <span className="font-mono text-background/70 text-xs">{label}</span>
        <CopyButton label={label} value={code} />
      </figcaption>
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-6">
        <code className={`language-${language}`}>{code}</code>
      </pre>
    </figure>
  )
}
