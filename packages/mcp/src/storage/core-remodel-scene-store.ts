import { generateSlug } from './slug'
import {
  type ProjectCreateOptions,
  type ProjectStatus,
  type SceneEvent,
  type SceneEventAppendOptions,
  type SceneEventListOptions,
  SceneInvalidError,
  type SceneListOptions,
  type SceneMeta,
  type SceneMutateOptions,
  SceneNotFoundError,
  type SceneSaveOptions,
  type SceneStore,
  SceneTooLargeError,
  SceneVersionConflictError,
  type SceneWithGraph,
} from './types'

export interface CoreRemodelSceneStoreOptions {
  baseUrl: string
  token?: string
  fetch?: typeof fetch
}

type ErrorPayload = { error?: string | { message?: string }; message?: string }

function trimBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) throw new SceneInvalidError('CORE_REMODEL_API_URL must not be empty')
  try {
    return new URL(trimmed).toString().replace(/\/$/, '')
  } catch {
    throw new SceneInvalidError('CORE_REMODEL_API_URL must be an absolute URL')
  }
}

function queryString(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) params.set(key, String(value))
  }
  const encoded = params.toString()
  return encoded ? `?${encoded}` : ''
}

/**
 * SceneStore adapter for the Core Remodel Pascal integration API.
 *
 * This adapter deliberately owns no customer or project logic. It sends scene
 * graph state and rendering lineage to Core Remodel, which authorizes the
 * project and persists the authoritative association.
 */
export class CoreRemodelSceneStore implements SceneStore {
  readonly backend = 'core-remodel' as const

  private readonly baseUrl: string
  private readonly token?: string
  private readonly fetchImpl: typeof fetch

  constructor(options: CoreRemodelSceneStoreOptions) {
    this.baseUrl = trimBaseUrl(options.baseUrl)
    this.token = options.token
    this.fetchImpl = options.fetch ?? globalThis.fetch
  }

  createProject(options: ProjectCreateOptions): Promise<ProjectStatus> {
    return this.request<ProjectStatus>('/projects', {
      method: 'POST',
      body: JSON.stringify(options),
    })
  }

  async getProjectStatus(id: string): Promise<ProjectStatus | null> {
    return this.requestNullable<ProjectStatus>(`/projects/${encodeURIComponent(id)}`)
  }

  save(options: SceneSaveOptions): Promise<SceneMeta> {
    const id = options.id ?? generateSlug()
    return this.request<SceneMeta>(`/scenes/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ ...options, id }),
    })
  }

  load(id: string): Promise<SceneWithGraph | null> {
    return this.requestNullable<SceneWithGraph>(`/scenes/${encodeURIComponent(id)}`)
  }

  async list(options: SceneListOptions = {}): Promise<SceneMeta[]> {
    const response = await this.request<{ scenes: SceneMeta[] }>(
      `/scenes${queryString({
        projectId: options.projectId,
        ownerId: options.ownerId,
        limit: options.limit,
      })}`,
    )
    return response.scenes
  }

  async delete(id: string, options: SceneMutateOptions = {}): Promise<boolean> {
    const response = await this.request<Response>(
      `/scenes/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        headers:
          options.expectedVersion === undefined
            ? undefined
            : { 'If-Match': `"${options.expectedVersion}"` },
      },
      true,
    )
    return response.status !== 404
  }

  rename(id: string, newName: string, options: SceneMutateOptions = {}): Promise<SceneMeta> {
    return this.request<SceneMeta>(`/scenes/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: newName, expectedVersion: options.expectedVersion }),
    })
  }

  appendSceneEvent(options: SceneEventAppendOptions): Promise<SceneEvent> {
    return this.request<SceneEvent>(`/scenes/${encodeURIComponent(options.sceneId)}/events`, {
      method: 'POST',
      body: JSON.stringify(options),
    })
  }

  async listSceneEvents(
    sceneId: string,
    options: SceneEventListOptions = {},
  ): Promise<SceneEvent[]> {
    const response = await this.request<{ events: SceneEvent[] }>(
      `/scenes/${encodeURIComponent(sceneId)}/events${queryString({
        afterEventId: options.afterEventId,
        limit: options.limit,
      })}`,
    )
    return response.events
  }

  private async requestNullable<T>(path: string): Promise<T | null> {
    const response = await this.request<Response>(path, undefined, true)
    if (response.status === 404) return null
    return (await response.json()) as T
  }

  private async request<T>(path: string, init?: RequestInit, raw?: false): Promise<T>
  private async request<T extends Response>(
    path: string,
    init: RequestInit | undefined,
    raw: true,
  ): Promise<T>
  private async request<T>(path: string, init?: RequestInit, raw = false): Promise<T> {
    const headers = new Headers(init?.headers)
    headers.set('Accept', 'application/json')
    if (init?.body) headers.set('Content-Type', 'application/json')
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`)

    const response = await this.fetchImpl(`${this.baseUrl}/api/pascal/v1${path}`, {
      ...init,
      headers,
    })
    if (raw && response.status === 404) return response as T
    if (!response.ok) await this.throwResponseError(response)
    if (raw) return response as T
    return (await response.json()) as T
  }

  private async throwResponseError(response: Response): Promise<never> {
    let payload: ErrorPayload = {}
    try {
      payload = (await response.json()) as ErrorPayload
    } catch {
      payload = {}
    }
    const nestedMessage = typeof payload.error === 'object' ? payload.error.message : undefined
    const message =
      payload.message ??
      nestedMessage ??
      (typeof payload.error === 'string' ? payload.error : undefined) ??
      `Core Remodel request failed (${response.status})`
    if (response.status === 404) throw new SceneNotFoundError(message)
    if (response.status === 409 || response.status === 412) {
      throw new SceneVersionConflictError(message)
    }
    if (response.status === 413) throw new SceneTooLargeError(message)
    if (response.status === 400 || response.status === 422) throw new SceneInvalidError(message)
    throw new Error(message)
  }
}

export function createCoreRemodelSceneStore(env: NodeJS.ProcessEnv): CoreRemodelSceneStore {
  const baseUrl = env.CORE_REMODEL_API_URL
  if (!baseUrl) throw new SceneInvalidError('CORE_REMODEL_API_URL is required')
  return new CoreRemodelSceneStore({
    baseUrl,
    token: env.CORE_REMODEL_API_TOKEN,
  })
}
