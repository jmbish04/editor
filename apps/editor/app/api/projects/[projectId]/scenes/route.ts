import { z } from 'zod'
import { apiGraphSchema } from '@/lib/graph-schema'
import { sceneRenderingMetadataSchema } from '@/lib/rendering-metadata-schema'
import { sceneStoreErrorResponse } from '@/lib/scene-api-errors'
import { guardSceneApiRequest, sceneApiJson, sceneApiPreflight } from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type RouteParams = { params: Promise<{ projectId: string }> }

const createProjectSceneSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(200),
  graph: apiGraphSchema,
  thumbnailUrl: z.string().url().nullable().optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
  rendering: sceneRenderingMetadataSchema.nullable().optional(),
})

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
})

export function OPTIONS(request: Request) {
  return sceneApiPreflight(request)
}

export async function GET(request: Request, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const { projectId } = await params
  const url = new URL(request.url)
  const parsed = listQuerySchema.safeParse({ limit: url.searchParams.get('limit') ?? undefined })
  if (!parsed.success) {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    )
  }

  try {
    const operations = await getSceneOperations()
    const scenes = await operations.listScenes({ projectId, limit: parsed.data.limit })
    return sceneApiJson(request, { projectId, scenes, backend: operations.storeBackend })
  } catch (error) {
    return sceneStoreErrorResponse(request, error)
  }
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
  const parsed = createProjectSceneSchema.safeParse(body)
  if (!parsed.success) {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    )
  }
  if (parsed.data.rendering?.coreRemodelProjectId !== undefined) {
    if (parsed.data.rendering.coreRemodelProjectId !== projectId) {
      return sceneApiJson(request, { error: 'project_identity_mismatch' }, { status: 409 })
    }
  }

  try {
    const operations = await getSceneOperations()
    const meta = await operations.saveScene({
      ...parsed.data,
      projectId,
      graph: parsed.data.graph as never,
      thumbnailUrl: parsed.data.thumbnailUrl ?? null,
      rendering: parsed.data.rendering ?? null,
    })
    return sceneApiJson(request, meta, {
      status: parsed.data.expectedVersion === undefined ? 201 : 200,
      headers: { ETag: `"${meta.version}"`, Location: `/scene/${meta.id}` },
    })
  } catch (error) {
    return sceneStoreErrorResponse(request, error)
  }
}
