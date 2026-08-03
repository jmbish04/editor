import { z } from 'zod'
import { apiGraphSchema } from '@/lib/graph-schema'
import { sceneRenderingMetadataSchema } from '@/lib/rendering-metadata-schema'
import { sceneStoreErrorResponse } from '@/lib/scene-api-errors'
import { guardSceneApiRequest, sceneApiJson, sceneApiPreflight } from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type RouteParams = { params: Promise<{ projectId: string }> }

const syncSchema = z.discriminatedUnion('direction', [
  z.object({
    direction: z.literal('pull'),
    sceneId: z.string().min(1).max(64),
  }),
  z.object({
    direction: z.literal('push'),
    scene: z.object({
      id: z.string().min(1).max(64),
      name: z.string().min(1).max(200),
      graph: apiGraphSchema,
      thumbnailUrl: z.string().url().nullable().optional(),
      expectedVersion: z.number().int().nonnegative().optional(),
      rendering: sceneRenderingMetadataSchema,
    }),
  }),
])

export function OPTIONS(request: Request) {
  return sceneApiPreflight(request)
}

export async function POST(request: Request, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const { projectId } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return sceneApiJson(request, { error: 'invalid_request' }, { status: 400 })
  }
  const parsed = syncSchema.safeParse(body)
  if (!parsed.success) {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    )
  }

  try {
    const operations = await getSceneOperations()
    if (parsed.data.direction === 'pull') {
      const scene = await operations.loadStoredScene(parsed.data.sceneId)
      if (!scene) return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
      const mappedProjectId = scene.rendering?.coreRemodelProjectId ?? scene.projectId
      if (mappedProjectId !== projectId) {
        return sceneApiJson(request, { error: 'project_identity_mismatch' }, { status: 409 })
      }
      return sceneApiJson(request, {
        direction: 'pull',
        projectId,
        backend: operations.storeBackend,
        scene,
      })
    }

    if (parsed.data.scene.rendering.coreRemodelProjectId !== projectId) {
      return sceneApiJson(request, { error: 'project_identity_mismatch' }, { status: 409 })
    }
    const meta = await operations.saveScene({
      ...parsed.data.scene,
      projectId,
      graph: parsed.data.scene.graph as never,
      thumbnailUrl: parsed.data.scene.thumbnailUrl ?? null,
    })
    return sceneApiJson(request, {
      direction: 'push',
      projectId,
      backend: operations.storeBackend,
      scene: meta,
    })
  } catch (error) {
    return sceneStoreErrorResponse(request, error)
  }
}
