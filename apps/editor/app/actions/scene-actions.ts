'use server'

import type { SceneGraph } from '@pascal-app/editor'
import { apiGraphSchema } from '@/lib/graph-schema'
import { sceneStoreErrorResponseBody } from '@/lib/scene-api-errors'
import { getSceneOperations } from '@/lib/scene-store-server'

type ActionResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string }

export async function createSceneAction(input: {
  name: string
  projectId?: string | null
  graph: SceneGraph
}): Promise<ActionResult<{ id: string; version: number }>> {
  const graph = apiGraphSchema.safeParse(input.graph)
  if (!graph.success) {
    return { ok: false, status: 400, error: 'invalid_request' }
  }

  try {
    const operations = await getSceneOperations()
    const projectId = input.projectId?.trim() || null
    if (!projectId && operations.storeBackend === 'core-remodel') {
      return { ok: false, status: 400, error: 'project_id_required' }
    }

    const meta = await operations.saveScene({
      name: input.name,
      projectId,
      graph: graph.data as never,
    })
    return { ok: true, data: { id: meta.id, version: meta.version } }
  } catch (error) {
    return sceneActionError(error)
  }
}

export async function updateSceneAction(input: {
  id: string
  name: string
  version: number
  graph: SceneGraph
}): Promise<ActionResult<{ version: number }>> {
  const graph = apiGraphSchema.safeParse(input.graph)
  if (!graph.success) {
    return { ok: false, status: 400, error: 'invalid_request' }
  }

  try {
    const operations = await getSceneOperations()
    const meta = await operations.saveScene({
      id: input.id,
      name: input.name,
      graph: graph.data as never,
      expectedVersion: input.version,
    })
    return { ok: true, data: { version: meta.version } }
  } catch (error) {
    return sceneActionError(error)
  }
}

function sceneActionError(error: unknown): ActionResult<never> {
  const body = sceneStoreErrorResponseBody(error)
  return { ok: false, status: body.status, error: body.error }
}
