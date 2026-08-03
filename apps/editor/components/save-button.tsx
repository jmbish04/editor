'use client'

import type { SceneGraph } from '@pascal-app/editor'
import { useRouter } from 'next/navigation'
import { type FormEvent, useCallback, useId, useState } from 'react'
import { createSceneAction, updateSceneAction } from '@/app/actions/scene-actions'

const EMPTY_GRAPH: SceneGraph = {
  nodes: {},
  rootNodeIds: [],
}

function sceneActionError(status: number, error: string, fallback: string): string {
  return `${error || fallback} (${status})`
}

interface SaveButtonProps {
  sceneId: string
  name: string
  version: number
  getGraph: () => SceneGraph | null
}

/**
 * Creates a new empty scene and navigates the user to it.
 */
export function CreateSceneButton({ label = 'Create new scene' }: { label?: string } = {}) {
  const router = useRouter()
  const projectIdInputId = useId()
  const [isOpen, setIsOpen] = useState(false)
  const [projectId, setProjectId] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const normalizedProjectId = projectId.trim()
      if (!normalizedProjectId) {
        setError('Enter a Core Remodel project ID.')
        return
      }

      setIsCreating(true)
      setError(null)
      try {
        const result = await createSceneAction({
          name: 'Untitled scene',
          projectId: normalizedProjectId,
          graph: EMPTY_GRAPH,
        })
        if (!result.ok) {
          setError(sceneActionError(result.status, result.error, 'Failed to create scene'))
          return
        }
        router.push(`/scene/${result.data.id}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create scene')
      } finally {
        setIsCreating(false)
      }
    },
    [projectId, router],
  )

  if (!isOpen) {
    return (
      <button
        className="rounded-md border border-border bg-accent px-3 py-1.5 font-medium text-sm hover:bg-accent/80"
        onClick={() => setIsOpen(true)}
        type="button"
      >
        {label}
      </button>
    )
  }

  return (
    <form className="flex flex-wrap items-center justify-end gap-2" onSubmit={handleCreate}>
      <label className="sr-only" htmlFor={projectIdInputId}>
        Core Remodel project ID
      </label>
      <input
        aria-describedby={error ? `${projectIdInputId}-error` : undefined}
        aria-invalid={error ? true : undefined}
        autoComplete="off"
        className="h-8 w-56 rounded-md border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        id={projectIdInputId}
        onChange={(event) => setProjectId(event.target.value)}
        placeholder="Core Remodel project ID"
        required
        spellCheck={false}
        type="text"
        value={projectId}
      />
      <button
        className="rounded-md border border-border bg-accent px-3 py-1.5 font-medium text-sm hover:bg-accent/80 disabled:opacity-50"
        disabled={isCreating}
        type="submit"
      >
        {isCreating ? 'Creating scene…' : 'Create scene'}
      </button>
      <button
        className="rounded-md px-2 py-1.5 text-muted-foreground text-sm hover:text-foreground disabled:opacity-50"
        disabled={isCreating}
        onClick={() => {
          setIsOpen(false)
          setError(null)
        }}
        type="button"
      >
        Cancel
      </button>
      {error && (
        <span
          className="w-full text-right text-destructive text-xs"
          id={`${projectIdInputId}-error`}
          role="alert"
        >
          {error}
        </span>
      )}
    </form>
  )
}

/**
 * Save + Save-as buttons that call the scenes API directly.
 * Used for UIs that want explicit save controls outside of the Editor's
 * built-in autosave plumbing.
 */
export function SaveButton({ sceneId, name, version, getGraph }: SaveButtonProps) {
  const router = useRouter()
  const [isSaving, setIsSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const handleSave = useCallback(async () => {
    const graph = getGraph()
    if (!graph) {
      setStatus('No scene to save')
      return
    }
    setIsSaving(true)
    setStatus(null)
    try {
      const result = await updateSceneAction({
        id: sceneId,
        name,
        version,
        graph,
      })
      if (!result.ok && result.status === 409) {
        setStatus('Conflict — reload to continue')
        return
      }
      if (!result.ok) {
        setStatus(sceneActionError(result.status, result.error, 'Save failed'))
        return
      }
      setStatus('Saved')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Save failed')
    } finally {
      setIsSaving(false)
    }
  }, [getGraph, name, sceneId, version])

  const handleSaveAs = useCallback(async () => {
    const graph = getGraph()
    if (!graph) {
      setStatus('No scene to save')
      return
    }
    const newName = typeof window !== 'undefined' ? window.prompt('New scene name', name) : null
    if (!newName) return
    setIsSaving(true)
    setStatus(null)
    try {
      const result = await createSceneAction({
        name: newName,
        graph,
      })
      if (!result.ok) {
        setStatus(sceneActionError(result.status, result.error, 'Save-as failed'))
        return
      }
      router.push(`/scene/${result.data.id}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Save-as failed')
    } finally {
      setIsSaving(false)
    }
  }, [getGraph, name, router])

  return (
    <div className="flex items-center gap-2">
      <button
        className="rounded-md border border-border bg-accent px-3 py-1.5 font-medium text-xs hover:bg-accent/80 disabled:opacity-50"
        disabled={isSaving}
        onClick={handleSave}
        type="button"
      >
        {isSaving ? 'Saving…' : 'Save'}
      </button>
      <button
        className="rounded-md border border-border bg-background px-3 py-1.5 font-medium text-xs hover:bg-accent/40 disabled:opacity-50"
        disabled={isSaving}
        onClick={handleSaveAs}
        type="button"
      >
        Save as…
      </button>
      {status && <span className="text-muted-foreground text-xs">{status}</span>}
    </div>
  )
}
