import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnyNodeId } from '@pascal-app/core/schema'
import { CeilingNode, SlabNode, WallNode, ZoneNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { ErrorCode, throwMcpError } from './errors'
import { publishLiveSceneSnapshot } from './live-sync'
import { measurement } from './measurement'
import { NodeIdSchema } from './schemas'

const bboxSchema = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  width: z.number().positive().max(100),
  height: z.number().positive().max(100),
})

const measuredRoomSchema = z.object({
  sourceRoomId: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  measuredWidth: measurement('length', 'm', { positive: true }),
  measuredDepth: measurement('length', 'm', { positive: true }),
  bbox: bboxSchema,
  confidence: z.number().min(0).max(1).optional(),
  measurementIds: z.array(z.string().min(1).max(200)).max(100).default([]),
  color: z.string().optional(),
})

export const seedMeasuredRoomsInput = {
  levelId: NodeIdSchema,
  rooms: z.array(measuredRoomSchema).min(1).max(200),
  bboxUnit: z.enum(['percent', 'fraction']).default('percent'),
  wallHeight: measurement('length', 'm', { positive: true }).optional(),
  wallThickness: measurement('length', 'm', { positive: true }).optional(),
}

export const seedMeasuredRoomsOutput = {
  coordinateSystem: z.literal('x-z-meters-y-up'),
  geometryBasis: z.literal('measured-rectangle-bbox-placement'),
  placementScale: z.object({
    xMetersPerNormalizedUnit: z.number(),
    zMetersPerNormalizedUnit: z.number(),
  }),
  rooms: z.array(z.record(z.string(), z.unknown())),
  warnings: z.array(z.string()),
}

type Bbox = z.infer<typeof bboxSchema>
type MeasuredRoom = z.infer<typeof measuredRoomSchema>

function normalizedBbox(bbox: Bbox, unit: 'percent' | 'fraction') {
  const divisor = unit === 'percent' ? 100 : 1
  const normalized = {
    x: bbox.x / divisor,
    y: bbox.y / divisor,
    width: bbox.width / divisor,
    height: bbox.height / divisor,
  }
  if (
    normalized.x + normalized.width > 1 + Number.EPSILON ||
    normalized.y + normalized.height > 1 + Number.EPSILON
  ) {
    throwMcpError(ErrorCode.InvalidParams, 'room_bbox_out_of_bounds', { bbox, unit })
  }
  return normalized
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle]!
  return (sorted[middle - 1]! + sorted[middle]!) / 2
}

function geometryMetadata(room: MeasuredRoom, normalized: ReturnType<typeof normalizedBbox>) {
  return {
    geometryBasis: 'measured-rectangle-bbox-placement',
    geometryStatus: 'provisional-rectangle',
    sourceRoomId: room.sourceRoomId,
    sourceBbox: room.bbox,
    normalizedBbox: normalized,
    measuredWidthM: room.measuredWidth,
    measuredDepthM: room.measuredDepth,
    measurementIds: room.measurementIds,
    confidence: room.confidence ?? null,
  }
}

/**
 * Seed an honest deterministic base from Core Remodel room measurements.
 * Room boxes control placement only; exact measured dimensions control size.
 */
export function registerSeedMeasuredRooms(server: McpServer, operations: SceneOperations): void {
  server.registerTool(
    'seed_measured_rooms',
    {
      title: 'Seed measured room rectangles',
      description:
        'Create provisional rectangular rooms at exact measured width/depth, positioned from Core Remodel percent boxes. This does not claim inferred walls are field-verified.',
      inputSchema: seedMeasuredRoomsInput,
      outputSchema: seedMeasuredRoomsOutput,
    },
    async ({ levelId, rooms, bboxUnit, wallHeight, wallThickness }) => {
      const level = operations.getNode(levelId as AnyNodeId)
      if (level?.type !== 'level') {
        throwMcpError(ErrorCode.InvalidParams, 'level_not_found', { levelId })
      }
      if (
        typeof level.metadata === 'object' &&
        level.metadata !== null &&
        (level.metadata as Record<string, unknown>).role === 'roof'
      ) {
        throwMcpError(ErrorCode.InvalidParams, 'cannot_seed_rooms_on_roof_level', { levelId })
      }

      const sourceIds = new Set<string>()
      for (const room of rooms) {
        if (sourceIds.has(room.sourceRoomId)) {
          throwMcpError(ErrorCode.InvalidParams, 'duplicate_source_room_id', {
            sourceRoomId: room.sourceRoomId,
          })
        }
        sourceIds.add(room.sourceRoomId)
      }

      const normalized = rooms.map((room) => normalizedBbox(room.bbox, bboxUnit))
      const scaleX = median(
        rooms.map((room, index) => room.measuredWidth / normalized[index]!.width),
      )
      const scaleZ = median(
        rooms.map((room, index) => room.measuredDepth / normalized[index]!.height),
      )
      const originX = Math.min(...normalized.map((bbox) => bbox.x))
      const originZ = Math.min(...normalized.map((bbox) => bbox.y))
      const created: Array<Record<string, unknown>> = []
      const patches: Parameters<SceneOperations['applyPatch']>[0] = []

      rooms.forEach((room, index) => {
        const bbox = normalized[index]!
        const centerX = (bbox.x + bbox.width / 2 - originX) * scaleX
        const centerZ = (bbox.y + bbox.height / 2 - originZ) * scaleZ
        const halfWidth = room.measuredWidth / 2
        const halfDepth = room.measuredDepth / 2
        const polygon: Array<[number, number]> = [
          [centerX - halfWidth, centerZ - halfDepth],
          [centerX + halfWidth, centerZ - halfDepth],
          [centerX + halfWidth, centerZ + halfDepth],
          [centerX - halfWidth, centerZ + halfDepth],
        ]
        const metadata = geometryMetadata(room, bbox)
        const zone = ZoneNode.parse({
          name: room.name,
          polygon,
          color: room.color ?? '#60a5fa',
          metadata,
        })
        const slab = SlabNode.parse({ polygon, metadata })
        const ceiling = CeilingNode.parse({ polygon, metadata })
        const walls = polygon.map((start, edgeIndex) =>
          WallNode.parse({
            name: `${room.name} provisional wall ${edgeIndex + 1}`,
            start,
            end: polygon[(edgeIndex + 1) % polygon.length],
            ...(wallHeight !== undefined ? { height: wallHeight } : {}),
            ...(wallThickness !== undefined ? { thickness: wallThickness } : {}),
            metadata: { ...metadata, edgeIndex },
          }),
        )
        patches.push(
          { op: 'create', node: zone, parentId: levelId as AnyNodeId },
          { op: 'create', node: slab, parentId: levelId as AnyNodeId },
          { op: 'create', node: ceiling, parentId: levelId as AnyNodeId },
          ...walls.map((wall) => ({
            op: 'create' as const,
            node: wall,
            parentId: levelId as AnyNodeId,
          })),
        )
        created.push({
          sourceRoomId: room.sourceRoomId,
          zoneId: zone.id,
          slabId: slab.id,
          ceilingId: ceiling.id,
          wallIds: walls.map((wall) => wall.id),
          center: [centerX, 0, centerZ],
          polygon,
          measuredBounds: { width: room.measuredWidth, depth: room.measuredDepth },
        })
      })

      operations.applyPatch(patches)
      await publishLiveSceneSnapshot(operations, 'seed_measured_rooms')
      const payload = {
        coordinateSystem: 'x-z-meters-y-up' as const,
        geometryBasis: 'measured-rectangle-bbox-placement' as const,
        placementScale: { xMetersPerNormalizedUnit: scaleX, zMetersPerNormalizedUnit: scaleZ },
        rooms: created,
        warnings: [
          'Room rectangles use exact measured sizes, but their walls and adjacency are provisional.',
          'Percent boxes control placement only; refine field-verified wall coordinates in Pascal.',
        ],
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}
