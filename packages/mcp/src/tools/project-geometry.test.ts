import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SceneBridge } from '../bridge/scene-bridge'
import { createSceneOperations } from '../operations'
import { registerSeedMeasuredRooms } from './measured-rooms'
import { registerProjectGeometryTools } from './project-geometry'
import { InMemorySceneStore } from './scene-lifecycle/test-utils'

function toolPayload(result: Awaited<ReturnType<Client['callTool']>>) {
  return JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
}

async function testClient() {
  const bridge = new SceneBridge()
  bridge.setScene({}, [])
  bridge.loadDefault()
  const store = new InMemorySceneStore()
  const operations = createSceneOperations({ bridge, store })
  const server = new McpServer({ name: 'geometry-test', version: '0.0.0' })
  registerSeedMeasuredRooms(server, operations)
  registerProjectGeometryTools(server, operations)
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'geometry-client', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return { bridge, operations, client }
}

describe('measured project geometry tools', () => {
  test('seeds exact measured rectangles using percent boxes only for placement', async () => {
    const { bridge, client } = await testClient()
    const level = Object.values(bridge.getNodes()).find((node) => node.type === 'level')!
    const result = await client.callTool({
      name: 'seed_measured_rooms',
      arguments: {
        levelId: level.id,
        rooms: [
          {
            sourceRoomId: 'living',
            name: 'Living room',
            measuredWidth: 4,
            measuredDepth: 3,
            bbox: { x: 0, y: 0, width: 40, height: 50 },
            measurementIds: ['living-width', 'living-depth'],
          },
          {
            sourceRoomId: 'kitchen',
            name: 'Kitchen',
            measuredWidth: 5,
            measuredDepth: 3,
            bbox: { x: 50, y: 0, width: 50, height: 50 },
          },
        ],
      },
    })

    expect(result.isError).toBeFalsy()
    const payload = toolPayload(result)
    expect(payload.geometryBasis).toBe('measured-rectangle-bbox-placement')
    expect(payload.rooms[0].measuredBounds).toEqual({ width: 4, depth: 3 })
    expect(payload.rooms[1].measuredBounds).toEqual({ width: 5, depth: 3 })
    expect(payload.rooms[0].center).toEqual([2, 0, 1.5])
    expect(payload.rooms[1].center).toEqual([7.5, 0, 1.5])

    const validation = toolPayload(
      await client.callTool({ name: 'validate_measured_geometry', arguments: {} }),
    )
    expect(validation.valid).toBe(true)
    expect(validation.checkedRoomCount).toBe(2)
  })

  test('returns granular stored coordinates only for the mapped Core Remodel project', async () => {
    const { bridge, operations, client } = await testClient()
    const building = Object.values(bridge.getNodes()).find((node) => node.type === 'building')!
    bridge.updateNode(building.id, {
      position: [10, 0, 20],
      rotation: [0, Math.PI / 2, 0],
    })
    const level = Object.values(bridge.getNodes()).find((node) => node.type === 'level')!
    await client.callTool({
      name: 'seed_measured_rooms',
      arguments: {
        levelId: level.id,
        rooms: [
          {
            sourceRoomId: 'bathroom',
            name: 'Bathroom',
            measuredWidth: 2.4,
            measuredDepth: 1.8,
            bbox: { x: 10, y: 20, width: 30, height: 30 },
          },
        ],
      },
    })
    await operations.saveScene({
      id: 'variant-a',
      name: 'Measured base',
      projectId: 'project-123',
      graph: operations.exportSceneGraph(),
      rendering: {
        coreRemodelProjectId: 'project-123',
        variant: { id: 'variant-a', label: 'Measured base', parentSceneId: null },
        measurements: [],
        confidence: 0.9,
        provenance: {
          source: 'core-remodel',
          generatedAt: '2026-07-31T12:00:00.000Z',
          sourceRevision: 'revision-4',
          requestId: 'request-7',
        },
      },
    })

    const result = await client.callTool({
      name: 'get_project_geometry',
      arguments: { projectId: 'project-123', sceneId: 'variant-a', detail: 'full' },
    })
    expect(result.isError).toBeFalsy()
    const payload = toolPayload(result)
    expect(payload.coordinateSystem.units).toBe('meters')
    expect(payload.geometry.walls).toHaveLength(4)
    expect(payload.geometry.walls[0].coordinateFrame).toBe('level-local')
    expect(payload.geometry.walls[0].levelId).toBe(level.id)
    expect(payload.geometry.levels[0].buildingTransform.position).toEqual([10, 0, 20])
    expect(payload.geometry.levels[0].buildingTransform.rotation[1]).toBeCloseTo(Math.PI / 2)
    expect(payload.geometryHonesty.status).toBe('derived-from-node-evidence')
    expect(payload.geometry.walls[0].start[0]).toBeCloseTo(0, 10)
    expect(payload.geometry.walls[0].start[1]).toBeCloseTo(0, 10)
    expect(payload.geometry.zones[0].polygon).toHaveLength(4)
    expect(payload.geometry.zones[0].bounds.width).toBeCloseTo(2.4, 10)
    expect(payload.geometry.zones[0].bounds.depth).toBeCloseTo(1.8, 10)
    expect(payload.measuredBoundsValidation.valid).toBe(true)
    expect(payload.nodes[payload.geometry.zones[0].id].metadata.sourceRoomId).toBe('bathroom')

    const denied = await client.callTool({
      name: 'get_project_geometry',
      arguments: { projectId: 'another-project', sceneId: 'variant-a' },
    })
    expect(denied.isError).toBe(true)
  })

  test('detects AI edits that leave authoritative measured bounds', async () => {
    const { bridge, client } = await testClient()
    const level = Object.values(bridge.getNodes()).find((node) => node.type === 'level')!
    const seeded = toolPayload(
      await client.callTool({
        name: 'seed_measured_rooms',
        arguments: {
          levelId: level.id,
          rooms: [
            {
              sourceRoomId: 'bedroom',
              name: 'Bedroom',
              measuredWidth: 4,
              measuredDepth: 3,
              bbox: { x: 0, y: 0, width: 100, height: 100 },
            },
          ],
        },
      }),
    )
    bridge.updateNode(seeded.rooms[0].zoneId, {
      polygon: [
        [0, 0],
        [5, 0],
        [5, 3],
        [0, 3],
      ],
    })

    const validation = toolPayload(
      await client.callTool({ name: 'validate_measured_geometry', arguments: {} }),
    )
    expect(validation.valid).toBe(false)
    expect(validation.rooms[0].deltaM.width).toBe(1)
  })

  test.each([
    'wall',
    'slab',
    'ceiling',
  ] as const)('detects independent %s edits to a measured room bundle', async (component) => {
    const { bridge, client } = await testClient()
    const level = Object.values(bridge.getNodes()).find((node) => node.type === 'level')!
    const seeded = toolPayload(
      await client.callTool({
        name: 'seed_measured_rooms',
        arguments: {
          levelId: level.id,
          rooms: [
            {
              sourceRoomId: 'office',
              name: 'Office',
              measuredWidth: 4,
              measuredDepth: 3,
              bbox: { x: 0, y: 0, width: 100, height: 100 },
            },
          ],
        },
      }),
    )
    const room = seeded.rooms[0]
    if (component === 'wall') {
      const wall = bridge.getNode(room.wallIds[0])!
      if (wall.type !== 'wall') throw new Error('expected wall')
      bridge.updateNode(wall.id, { end: [wall.end[0] + 0.5, wall.end[1]] })
    } else {
      const nodeId = component === 'slab' ? room.slabId : room.ceilingId
      bridge.updateNode(nodeId, {
        polygon: [
          [0, 0],
          [5, 0],
          [5, 3],
          [0, 3],
        ],
      })
    }

    const validation = toolPayload(
      await client.callTool({ name: 'validate_measured_geometry', arguments: {} }),
    )
    expect(validation.status).toBe('invalid')
    expect(validation.valid).toBe(false)
    const componentResult = validation.rooms[0].components.find(
      (candidate: { kind: string }) =>
        candidate.kind === (component === 'wall' ? 'walls' : component),
    )
    expect(componentResult.withinTolerance).toBe(false)
  })

  test('reports measured validation as not applicable without evidence', async () => {
    const { client } = await testClient()
    const validation = toolPayload(
      await client.callTool({ name: 'validate_measured_geometry', arguments: {} }),
    )
    expect(validation).toMatchObject({
      applicable: false,
      status: 'not_applicable',
      valid: null,
      checkedRoomCount: 0,
    })
  })
})
