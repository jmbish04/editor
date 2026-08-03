import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { apiGraphSchema } from '@/lib/graph-schema'
import { sceneRenderingMetadataSchema } from '@/lib/rendering-metadata-schema'
import { sceneStoreErrorResponse } from '@/lib/scene-api-errors'
import { guardSceneApiRequest, sceneApiJson, sceneApiPreflight } from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'

const createSceneSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(200),
  projectId: z.string().min(1).max(200).nullable().optional(),
  graph: apiGraphSchema,
  thumbnailUrl: z.string().url().nullable().optional(),
  rendering: sceneRenderingMetadataSchema.nullable().optional(),
})

const listQuerySchema = z.object({
  projectId: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
})

export function OPTIONS(request: NextRequest) {
  return sceneApiPreflight(request)
}

export async function GET(request: NextRequest) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const url = new URL(request.url)
  const parsed = listQuerySchema.safeParse({
    projectId: url.searchParams.get('projectId') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  })
  if (!parsed.success) {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    )
  }

  const operations = await getSceneOperations()
  const scenes = await operations.listScenes({
    projectId: parsed.data.projectId,
    limit: parsed.data.limit,
  })
  return sceneApiJson(request, { scenes })
}

export async function POST(request: NextRequest) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: 'body must be valid JSON' },
      { status: 400 },
    )
  }

  const parsed = createSceneSchema.safeParse(body)
  if (!parsed.success) {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    )
  }

  const operations = await getSceneOperations()
  try {
    let sceneId = parsed.data.id
    let projectId = parsed.data.projectId ?? null
    if (!projectId && operations.storeBackend === 'core-remodel') {
      return sceneApiJson(
        request,
        {
          error: 'project_id_required',
          message: 'Enter an existing Core Remodel project ID to create this scene.',
        },
        { status: 400 },
      )
    }
    if (!projectId && operations.canCreateProject) {
      const project = await operations.createProject({
        ...(sceneId ? { id: sceneId } : {}),
        name: parsed.data.name,
      })
      projectId = project.projectId
    }
    const meta = await operations.saveScene({
      id: sceneId,
      name: parsed.data.name,
      projectId,
      graph: parsed.data.graph as never,
      thumbnailUrl: parsed.data.thumbnailUrl ?? null,
      rendering: parsed.data.rendering ?? null,
    })
    return sceneApiJson(request, meta, {
      status: 201,
      headers: { Location: `/scene/${meta.id}` },
    })
  } catch (error) {
    return sceneStoreErrorResponse(request, error)
  }
}
