import type { NextResponse } from 'next/server'
import { sceneApiJson } from './scene-api-security'

export function sceneStoreErrorResponseBody(error: unknown): { error: string; status: number } {
  const code = (error as { code?: string })?.code
  if (code === 'version_conflict') return { error: 'version_conflict', status: 409 }
  if (code === 'not_found') return { error: 'not_found', status: 404 }
  if (code === 'too_large') return { error: 'too_large', status: 413 }
  if (code === 'invalid') return { error: 'invalid', status: 400 }

  console.error('Scene API internal error', error)
  return { error: 'internal_error', status: 500 }
}

export function sceneStoreErrorResponse(request: Request, error: unknown): NextResponse {
  const body = sceneStoreErrorResponseBody(error)
  return sceneApiJson(request, { error: body.error }, { status: body.status })
}
