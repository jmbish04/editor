'use client'

import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'

export function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timeout = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timeout)
  }, [copied])

  async function copy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
  }

  return (
    <button
      aria-label={`Copy ${label}`}
      className="inline-flex h-11 items-center gap-1.5 rounded-md border border-border bg-background px-3 font-medium text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={copy}
      type="button"
    >
      {copied ? (
        <Check aria-hidden className="size-3.5" />
      ) : (
        <Copy aria-hidden className="size-3.5" />
      )}
      <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  )
}
