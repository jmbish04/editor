import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerCaptureSceneScreenshot } from './capture-scene-screenshot'
import { createTestSceneOperations, InMemorySceneStore } from './scene-lifecycle/test-utils'

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

describe('capture_scene_screenshot', () => {
  let client: Client
  let store: InMemorySceneStore
  let requests: Array<{ url: string; init?: RequestInit }>

  beforeEach(async () => {
    const bridge = new SceneBridge()
    bridge.loadDefault()
    store = new InMemorySceneStore()
    const { operations } = createTestSceneOperations({ bridge, store })
    await operations.saveScene({
      id: 'kitchen',
      name: 'Kitchen',
      projectId: 'project-1',
      graph: operations.exportSceneGraph(),
    })
    requests = []

    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerCaptureSceneScreenshot(server, operations, {
      accountId: 'account-1',
      apiToken: 'secret-token',
      editorBaseUrl: 'https://editor.example',
      now: () => new Date('2026-07-31T12:00:00.000Z'),
      fetch: async (input, init) => {
        requests.push({ url: String(input), init })
        if (String(input).endsWith('/browser-rendering/screenshot')) {
          return new Response(PNG, { headers: { 'Content-Type': 'image/png' } })
        }
        return Response.json({
          success: true,
          result: {
            id: 'image-1',
            filename: 'kitchen.png',
            uploaded: '2026-07-31T12:00:01.000Z',
            requireSignedURLs: false,
            variants: [
              'https://imagedelivery.net/account/image-1/thumbnail',
              'https://imagedelivery.net/account/image-1/original',
            ],
          },
        })
      },
    })
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  })

  test('captures the project scene, uploads it, and updates its thumbnail', async () => {
    const result = await client.callTool({
      name: 'capture_scene_screenshot',
      arguments: { sceneId: 'kitchen', projectId: 'project-1' },
    })

    expect(result.isError).toBeFalsy()
    const payload = result.structuredContent as Record<string, unknown>
    expect(payload.imageId).toBe('image-1')
    expect(payload.deliveryUrl).toBe('https://imagedelivery.net/account/image-1/original')
    expect(payload.capturedUrl).toBe('https://editor.example/scene/kitchen')
    expect(payload.sceneVersion).toBe(2)
    expect((await store.load('kitchen'))?.thumbnailUrl).toBe(payload.deliveryUrl)

    expect(requests).toHaveLength(2)
    const captureBody = JSON.parse(String(requests[0]!.init?.body))
    expect(captureBody.viewport).toEqual({ width: 1440, height: 900, deviceScaleFactor: 1 })
    expect(new Headers(requests[0]!.init?.headers).get('Authorization')).toBe('Bearer secret-token')
    expect(requests[1]!.init?.body).toBeInstanceOf(FormData)
    expect(new Headers(requests[1]!.init?.headers).has('Content-Type')).toBe(false)
  })

  test('rejects signed delivery when asked to set a scene thumbnail', async () => {
    const result = await client.callTool({
      name: 'capture_scene_screenshot',
      arguments: { sceneId: 'kitchen', requireSignedURLs: true },
    })
    expect(result.isError).toBe(true)
    expect(requests).toHaveLength(0)
  })
})
