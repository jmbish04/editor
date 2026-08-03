import { describe, expect, test } from 'bun:test'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { CoreRemodelSceneStore } from './core-remodel-scene-store'
import { createSceneStore } from './index'
import { SceneInvalidError, SceneVersionConflictError } from './types'

const graph: SceneGraph = {
  nodes: {
    site_test: {
      object: 'node',
      id: 'site_test',
      type: 'site',
      parentId: null,
      visible: true,
      metadata: {},
    },
  } as SceneGraph['nodes'],
  rootNodeIds: ['site_test'] as SceneGraph['rootNodeIds'],
}

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status })
}

describe('CoreRemodelSceneStore', () => {
  test('is selected by the shared factory when Core Remodel is configured', async () => {
    const store = await createSceneStore({
      CORE_REMODEL_API_URL: 'https://core-remodel.example',
      CORE_REMODEL_API_TOKEN: 'secret-token',
    })
    expect(store.backend).toBe('core-remodel')
  })

  test('saves rendering metadata through the versioned Pascal API with bearer auth', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const store = new CoreRemodelSceneStore({
      baseUrl: 'https://core-remodel.example/',
      token: 'secret-token',
      fetch: async (input, init) => {
        requests.push({ url: String(input), init })
        return jsonResponse({ id: 'variant-a', version: 4 })
      },
    })
    const rendering = {
      coreRemodelProjectId: 'project-123',
      variant: { id: 'variant-a', label: 'Open kitchen', parentSceneId: null },
      measurements: [
        {
          measurementId: 'measurement-1',
          kind: 'wall-length',
          value: 12.5,
          unit: 'ft',
          confidence: 0.98,
          sourceRevision: 'rev-7',
        },
      ],
      confidence: 0.95,
      provenance: {
        source: 'core-remodel' as const,
        generatedAt: '2026-07-31T12:00:00.000Z',
        sourceRevision: 'rev-7',
        requestId: 'request-9',
      },
    }

    await store.save({
      id: 'variant-a',
      name: 'Open kitchen',
      projectId: 'project-123',
      graph,
      expectedVersion: 3,
      rendering,
    })

    expect(requests).toHaveLength(1)
    expect(requests[0]!.url).toBe('https://core-remodel.example/api/pascal/v1/scenes/variant-a')
    expect(new Headers(requests[0]!.init?.headers).get('Authorization')).toBe('Bearer secret-token')
    expect(JSON.parse(String(requests[0]!.init?.body)).rendering).toEqual(rendering)
  })

  test('loads and lists scenes by external project identity', async () => {
    const urls: string[] = []
    const store = new CoreRemodelSceneStore({
      baseUrl: 'https://core-remodel.example',
      fetch: async (input) => {
        const url = String(input)
        urls.push(url)
        if (url.includes('?')) return jsonResponse({ scenes: [] })
        return jsonResponse({ id: 'scene-a', graph })
      },
    })

    expect((await store.load('scene-a'))?.id).toBe('scene-a')
    expect(await store.list({ projectId: 'project/123', limit: 5 })).toEqual([])
    expect(urls[1]).toBe(
      'https://core-remodel.example/api/pascal/v1/scenes?projectId=project%2F123&limit=5',
    )
  })

  test('maps remote optimistic-lock failures to SceneVersionConflictError', async () => {
    const store = new CoreRemodelSceneStore({
      baseUrl: 'https://core-remodel.example',
      fetch: async () => jsonResponse({ error: 'stale_scene' }, 409),
    })

    await expect(store.rename('scene-a', 'New name', { expectedVersion: 2 })).rejects.toThrow(
      SceneVersionConflictError,
    )
  })

  test('preserves nested Core Remodel validation messages', async () => {
    const store = new CoreRemodelSceneStore({
      baseUrl: 'https://core-remodel.example',
      fetch: async () =>
        jsonResponse(
          { success: false, error: { name: 'ZodError', message: 'projectId is required' } },
          400,
        ),
    })

    await expect(
      store.save({ id: 'scene-a', name: 'Scene A', projectId: null, graph }),
    ).rejects.toThrow(new SceneInvalidError('projectId is required'))
  })
})
