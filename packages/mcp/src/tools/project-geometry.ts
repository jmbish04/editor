import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import type { AnyNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import type { SceneRenderingMetadata } from '../storage/types'
import { ErrorCode, throwMcpError } from './errors'

const detailSchema = z.enum(['summary', 'full'])
const point2Schema = z.tuple([z.number(), z.number()])
const vector3Schema = z.tuple([z.number(), z.number(), z.number()])
const boundsSchema = z.object({
  minX: z.number(),
  maxX: z.number(),
  minZ: z.number(),
  maxZ: z.number(),
  width: z.number(),
  depth: z.number(),
})
const metadataSchema = z.unknown().optional()
const componentValidationSchema = z.object({
  kind: z.enum(['zone', 'slab', 'ceiling', 'walls']),
  nodeIds: z.array(z.string()),
  actual: z.object({ width: z.number(), depth: z.number() }).nullable(),
  deltaM: z.object({ width: z.number(), depth: z.number() }).nullable(),
  withinTolerance: z.boolean(),
  issues: z.array(z.string()),
})
const roomValidationSchema = z.object({
  sourceRoomId: z.string(),
  measured: z.object({ width: z.number(), depth: z.number() }),
  actual: z.object({ width: z.number(), depth: z.number() }).nullable(),
  deltaM: z.object({ width: z.number(), depth: z.number() }).nullable(),
  withinTolerance: z.boolean(),
  components: z.array(componentValidationSchema),
})

export const getProjectGeometryInput = {
  projectId: z.string().min(1).max(200),
  sceneId: z.string().min(1).max(64),
  detail: detailSchema.default('full'),
  nodeTypes: z.array(z.string().min(1)).max(100).optional(),
  measurementToleranceM: z.number().nonnegative().max(1).default(0.01),
}

export const getProjectGeometryOutput = {
  scene: z.record(z.string(), z.unknown()),
  coordinateSystem: z.object({
    units: z.literal('meters'),
    floorPlane: z.tuple([z.literal('x'), z.literal('z')]),
    verticalAxis: z.literal('y'),
    wallZoneSurfaceCoordinates: z.literal('level-local [x,z]'),
    openingCoordinates: z.literal('host-local [x,y,z]'),
    itemCoordinates: z.literal('parent-local [x,y,z]'),
  }),
  geometryHonesty: z.object({
    status: z.enum(['declared', 'derived-from-node-evidence', 'unknown']),
    basis: z.enum(['measured-rectangle-bbox-placement', 'pascal-refined', 'imported', 'unknown']),
    sourceDetail: z.enum([
      'room-percent-boxes-and-measured-sizes',
      'field-verified-coordinates',
      'unknown',
    ]),
    provisionalElements: z.array(z.string()),
    validatedAt: z.string().nullable(),
    refinementOwner: z.literal('Pascal'),
  }),
  nodeCounts: z.record(z.string(), z.number()),
  geometry: z.object({
    buildings: z.array(
      z.object({
        id: z.string(),
        coordinateFrame: z.literal('site-local'),
        position: vector3Schema,
        rotation: vector3Schema,
        metadata: metadataSchema,
      }),
    ),
    levels: z.array(
      z.object({
        id: z.string(),
        buildingId: z.string().nullable(),
        name: z.string().optional(),
        floorIndex: z.number().optional(),
        buildingTransform: z
          .object({ position: vector3Schema, rotation: vector3Schema })
          .nullable(),
        metadata: metadataSchema,
      }),
    ),
    walls: z.array(
      z.object({
        id: z.string(),
        levelId: z.string().nullable(),
        coordinateFrame: z.literal('level-local'),
        name: z.string().optional(),
        start: point2Schema,
        end: point2Schema,
        height: z.number().optional(),
        thickness: z.number().optional(),
        openings: z.array(z.record(z.string(), z.unknown())),
        metadata: metadataSchema,
      }),
    ),
    zones: z.array(
      z.object({
        id: z.string(),
        levelId: z.string().nullable(),
        coordinateFrame: z.literal('level-local'),
        name: z.string().optional(),
        polygon: z.array(point2Schema),
        bounds: boundsSchema.nullable(),
        metadata: metadataSchema,
      }),
    ),
    openings: z.array(
      z.object({
        id: z.string(),
        type: z.enum(['door', 'window']),
        coordinateFrame: z.literal('host-local'),
        hostNodeId: z.string().nullable(),
        wallId: z.string().nullable(),
        roofSegmentId: z.string().nullable(),
        roofFace: z.string().nullable(),
        position: vector3Schema,
        width: z.number(),
        height: z.number(),
        metadata: metadataSchema,
      }),
    ),
    surfaces: z.array(
      z.object({
        id: z.string(),
        type: z.enum(['slab', 'ceiling']),
        levelId: z.string().nullable(),
        coordinateFrame: z.literal('level-local'),
        polygon: z.array(point2Schema),
        holes: z.array(z.unknown()),
        metadata: metadataSchema,
      }),
    ),
    items: z.array(
      z.object({
        id: z.string(),
        parentId: z.string().nullable(),
        coordinateFrame: z.literal('parent-local'),
        position: vector3Schema,
        rotation: vector3Schema,
        dimensions: vector3Schema,
        metadata: metadataSchema,
      }),
    ),
  }),
  measuredBoundsValidation: z.object({
    applicable: z.boolean(),
    status: z.enum(['valid', 'invalid', 'not_applicable']),
    valid: z.boolean().nullable(),
    checkedRoomCount: z.number().int().nonnegative(),
    rooms: z.array(roomValidationSchema),
  }),
  nodes: z.record(z.string(), z.unknown()).optional(),
  rootNodeIds: z.array(z.string()).optional(),
  collections: z.record(z.string(), z.unknown()).optional(),
}

export const validateMeasuredGeometryInput = {
  toleranceM: z.number().nonnegative().max(1).default(0.01),
}

export const validateMeasuredGeometryOutput =
  getProjectGeometryOutput.measuredBoundsValidation.shape

function metadata(node: AnyNode): Record<string, unknown> {
  return typeof node.metadata === 'object' && node.metadata !== null
    ? (node.metadata as Record<string, unknown>)
    : {}
}

function bounds(points: Array<[number, number]>) {
  const xs = points.map((point) => point[0])
  const zs = points.map((point) => point[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minZ = Math.min(...zs)
  const maxZ = Math.max(...zs)
  return { minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ }
}

function distance(a: [number, number], b: [number, number]): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

function dimensionsValidation(
  kind: 'zone' | 'slab' | 'ceiling',
  nodes: AnyNode[],
  measured: { width: number; depth: number },
  toleranceM: number,
) {
  const issues: string[] = []
  if (nodes.length !== 1) issues.push(`expected_one_${kind}_found_${nodes.length}`)
  const node = nodes[0]
  const polygon = node && 'polygon' in node ? (node.polygon as Array<[number, number]>) : []
  const actualBounds = polygon.length >= 3 ? bounds(polygon) : null
  if (!actualBounds) issues.push('polygon_missing_or_invalid')
  const actual = actualBounds ? { width: actualBounds.width, depth: actualBounds.depth } : null
  const deltaM = actual
    ? { width: actual.width - measured.width, depth: actual.depth - measured.depth }
    : null
  const withinTolerance =
    issues.length === 0 &&
    deltaM !== null &&
    Math.abs(deltaM.width) <= toleranceM &&
    Math.abs(deltaM.depth) <= toleranceM
  return {
    kind,
    nodeIds: nodes.map((candidate) => candidate.id),
    actual,
    deltaM,
    withinTolerance,
    issues,
  }
}

function wallsValidation(
  nodes: AnyNode[],
  measured: { width: number; depth: number },
  toleranceM: number,
) {
  const issues: string[] = []
  if (nodes.length !== 4) issues.push(`expected_four_walls_found_${nodes.length}`)
  const ordered = [...nodes].sort(
    (a, b) => Number(metadata(a).edgeIndex ?? -1) - Number(metadata(b).edgeIndex ?? -1),
  )
  const wallPoints = ordered.flatMap((node) =>
    'start' in node && 'end' in node
      ? [node.start as [number, number], node.end as [number, number]]
      : [],
  )
  const actualBounds = wallPoints.length > 0 ? bounds(wallPoints) : null
  if (ordered.length === 4) {
    ordered.forEach((node, index) => {
      const next = ordered[(index + 1) % ordered.length]!
      if (!('start' in node && 'end' in node && 'start' in next)) {
        issues.push(`wall_${index}_coordinates_missing`)
        return
      }
      const expectedLength = index % 2 === 0 ? measured.width : measured.depth
      if (Math.abs(distance(node.start, node.end) - expectedLength) > toleranceM) {
        issues.push(`wall_${index}_length_out_of_tolerance`)
      }
      if (distance(node.end, next.start) > toleranceM)
        issues.push(`wall_${index}_loop_disconnected`)
    })
  }
  const actual = actualBounds ? { width: actualBounds.width, depth: actualBounds.depth } : null
  const deltaM = actual
    ? { width: actual.width - measured.width, depth: actual.depth - measured.depth }
    : null
  const withinTolerance =
    issues.length === 0 &&
    deltaM !== null &&
    Math.abs(deltaM.width) <= toleranceM &&
    Math.abs(deltaM.depth) <= toleranceM
  return {
    kind: 'walls' as const,
    nodeIds: nodes.map((node) => node.id),
    actual,
    deltaM,
    withinTolerance,
    issues,
  }
}

export function validateMeasuredBounds(graph: SceneGraph, toleranceM: number) {
  const evidenceNodes = (Object.values(graph.nodes) as AnyNode[]).filter((node) => {
    const evidence = metadata(node)
    return (
      evidence.geometryBasis === 'measured-rectangle-bbox-placement' &&
      typeof evidence.sourceRoomId === 'string' &&
      typeof evidence.measuredWidthM === 'number' &&
      typeof evidence.measuredDepthM === 'number'
    )
  })
  const grouped = new Map<string, AnyNode[]>()
  for (const node of evidenceNodes) {
    const sourceRoomId = metadata(node).sourceRoomId as string
    grouped.set(sourceRoomId, [...(grouped.get(sourceRoomId) ?? []), node])
  }
  const rooms = [...grouped.entries()].map(([sourceRoomId, nodes]) => {
    const evidence = metadata(nodes[0]!)
    const measured = {
      width: evidence.measuredWidthM as number,
      depth: evidence.measuredDepthM as number,
    }
    const components = [
      dimensionsValidation(
        'zone',
        nodes.filter((node) => node.type === 'zone'),
        measured,
        toleranceM,
      ),
      dimensionsValidation(
        'slab',
        nodes.filter((node) => node.type === 'slab'),
        measured,
        toleranceM,
      ),
      dimensionsValidation(
        'ceiling',
        nodes.filter((node) => node.type === 'ceiling'),
        measured,
        toleranceM,
      ),
      wallsValidation(
        nodes.filter((node) => node.type === 'wall'),
        measured,
        toleranceM,
      ),
    ]
    const zone = components[0]!
    return {
      sourceRoomId,
      measured,
      actual: zone.actual,
      deltaM: zone.deltaM,
      withinTolerance: components.every((component) => component.withinTolerance),
      components,
    }
  })
  const applicable = rooms.length > 0
  const valid = applicable ? rooms.every((room) => room.withinTolerance) : null
  return {
    applicable,
    status: !applicable
      ? ('not_applicable' as const)
      : valid
        ? ('valid' as const)
        : ('invalid' as const),
    valid,
    checkedRoomCount: rooms.length,
    rooms,
  }
}

function summarizeGraph(graph: SceneGraph, nodeTypes?: string[]) {
  const typeFilter = nodeTypes ? new Set(nodeTypes) : null
  const allNodes = Object.values(graph.nodes) as AnyNode[]
  const selectedNodes = typeFilter ? allNodes.filter((node) => typeFilter.has(node.type)) : allNodes
  const byType = (type: string) => selectedNodes.filter((node) => node.type === type)
  const nodeCounts: Record<string, number> = {}
  for (const node of allNodes) nodeCounts[node.type] = (nodeCounts[node.type] ?? 0) + 1

  const buildings = byType('building').map((node) => ({
    id: node.id,
    coordinateFrame: 'site-local' as const,
    position: 'position' in node ? node.position : [0, 0, 0],
    rotation: 'rotation' in node ? node.rotation : [0, 0, 0],
    metadata: node.metadata,
  }))
  const allBuildings = new Map<string, AnyNode>(
    allNodes.filter((node) => node.type === 'building').map((node) => [node.id, node] as const),
  )
  const openings = selectedNodes
    .filter((node) => node.type === 'door' || node.type === 'window')
    .map((node) => ({
      id: node.id,
      type: node.type,
      coordinateFrame: 'host-local' as const,
      hostNodeId: node.wallId ?? node.roofSegmentId ?? null,
      wallId: node.wallId ?? null,
      roofSegmentId: node.roofSegmentId ?? null,
      roofFace: node.roofFace ?? null,
      position: node.position,
      width: node.width,
      height: node.height,
      metadata: node.metadata,
    }))
  const walls = byType('wall').map((node) => ({
    id: node.id,
    levelId: node.parentId ?? null,
    coordinateFrame: 'level-local' as const,
    name: 'name' in node ? node.name : undefined,
    start: 'start' in node ? node.start : [0, 0],
    end: 'end' in node ? node.end : [0, 0],
    height: 'height' in node ? node.height : undefined,
    thickness: 'thickness' in node ? node.thickness : undefined,
    openings: openings.filter((opening) => opening.wallId === node.id),
    metadata: node.metadata,
  }))
  const zones = byType('zone').map((node) => {
    const polygon = 'polygon' in node ? (node.polygon as Array<[number, number]>) : []
    return {
      id: node.id,
      levelId: node.parentId ?? null,
      coordinateFrame: 'level-local' as const,
      name: 'name' in node ? node.name : undefined,
      polygon,
      bounds: polygon.length > 0 ? bounds(polygon) : null,
      metadata: node.metadata,
    }
  })
  const surfaces = selectedNodes
    .filter((node) => node.type === 'slab' || node.type === 'ceiling')
    .map((node) => ({
      id: node.id,
      type: node.type,
      levelId: node.parentId ?? null,
      coordinateFrame: 'level-local' as const,
      polygon: node.polygon,
      holes: node.holes ?? [],
      metadata: node.metadata,
    }))
  const items = byType('item').map((node) => ({
    id: node.id,
    parentId: node.parentId ?? null,
    coordinateFrame: 'parent-local' as const,
    position: 'position' in node ? node.position : [0, 0, 0],
    rotation: 'rotation' in node ? node.rotation : [0, 0, 0],
    dimensions: 'asset' in node ? node.asset.dimensions : [1, 1, 1],
    metadata: node.metadata,
  }))
  const levels = byType('level').map((node) => {
    const building =
      (node.parentId ? allBuildings.get(node.parentId) : undefined) ??
      [...allBuildings.values()].find(
        (candidate) =>
          'children' in candidate &&
          Array.isArray(candidate.children) &&
          candidate.children.some((child) => String(child) === node.id),
      )
    const buildingId = building?.id ?? node.parentId ?? null
    return {
      id: node.id,
      buildingId,
      name: 'name' in node ? node.name : undefined,
      floorIndex: 'level' in node ? node.level : undefined,
      buildingTransform:
        building && 'position' in building && 'rotation' in building
          ? { position: building.position, rotation: building.rotation }
          : null,
      metadata: node.metadata,
    }
  })

  return {
    selectedNodes,
    nodeCounts,
    geometry: { buildings, levels, walls, zones, openings, surfaces, items },
  }
}

function geometryHonesty(graph: SceneGraph, declared?: SceneRenderingMetadata['geometry']) {
  if (declared) {
    return {
      status: 'declared' as const,
      basis: declared.basis,
      sourceDetail: declared.sourceDetail,
      provisionalElements: declared.provisionalElements,
      validatedAt: declared.validatedAt,
      refinementOwner: 'Pascal' as const,
    }
  }
  const hasMeasuredEvidence = (Object.values(graph.nodes) as AnyNode[]).some(
    (node) => metadata(node).geometryBasis === 'measured-rectangle-bbox-placement',
  )
  if (hasMeasuredEvidence) {
    return {
      status: 'derived-from-node-evidence' as const,
      basis: 'measured-rectangle-bbox-placement' as const,
      sourceDetail: 'room-percent-boxes-and-measured-sizes' as const,
      provisionalElements: ['wall coordinates', 'room adjacency', 'openings'],
      validatedAt: null,
      refinementOwner: 'Pascal' as const,
    }
  }
  return {
    status: 'unknown' as const,
    basis: 'unknown' as const,
    sourceDetail: 'unknown' as const,
    provisionalElements: [],
    validatedAt: null,
    refinementOwner: 'Pascal' as const,
  }
}

function geometryPayload(args: {
  graph: SceneGraph
  scene: Record<string, unknown>
  rendering?: SceneRenderingMetadata | null
  detail: 'summary' | 'full'
  nodeTypes?: string[]
  toleranceM: number
}) {
  const summarized = summarizeGraph(args.graph, args.nodeTypes)
  return {
    scene: args.scene,
    coordinateSystem: {
      units: 'meters' as const,
      floorPlane: ['x', 'z'] as const,
      verticalAxis: 'y' as const,
      wallZoneSurfaceCoordinates: 'level-local [x,z]' as const,
      openingCoordinates: 'host-local [x,y,z]' as const,
      itemCoordinates: 'parent-local [x,y,z]' as const,
    },
    geometryHonesty: geometryHonesty(args.graph, args.rendering?.geometry),
    nodeCounts: summarized.nodeCounts,
    geometry: summarized.geometry,
    measuredBoundsValidation: validateMeasuredBounds(args.graph, args.toleranceM),
    ...(args.detail === 'full'
      ? {
          nodes: Object.fromEntries(summarized.selectedNodes.map((node) => [node.id, node])),
          rootNodeIds: args.graph.rootNodeIds,
          collections: args.graph.collections ?? {},
        }
      : {}),
  }
}

export function registerProjectGeometryTools(server: McpServer, operations: SceneOperations): void {
  server.registerTool(
    'validate_measured_geometry',
    {
      title: 'Validate measured geometry',
      description:
        'Validate measured-room zones, slabs, ceilings, and provisional wall loops against their authoritative width/depth bounds.',
      inputSchema: validateMeasuredGeometryInput,
      outputSchema: validateMeasuredGeometryOutput,
    },
    async ({ toleranceM }) => {
      const payload = validateMeasuredBounds(operations.exportSceneGraph(), toleranceM)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )

  if (!operations.hasStore) return
  server.registerTool(
    'get_project_geometry',
    {
      title: 'Get project geometry',
      description:
        'Return model-ready Pascal geometry for one authorized Core Remodel project scene, including explicit coordinate frames, dimensions, evidence, and measured-bounds validation.',
      inputSchema: getProjectGeometryInput,
      outputSchema: getProjectGeometryOutput,
    },
    async ({ projectId, sceneId, detail, nodeTypes, measurementToleranceM }) => {
      const scene = await operations.loadStoredScene(sceneId)
      if (!scene) throwMcpError(ErrorCode.InvalidParams, 'scene_not_found', { sceneId })
      const mappedProjectId = scene.rendering?.coreRemodelProjectId ?? scene.projectId
      if (mappedProjectId !== projectId) {
        throwMcpError(ErrorCode.InvalidRequest, 'project_identity_mismatch', {
          projectId,
          mappedProjectId,
          sceneId,
        })
      }
      const payload = geometryPayload({
        graph: scene.graph,
        scene: {
          id: scene.id,
          name: scene.name,
          projectId: mappedProjectId,
          version: scene.version,
          rendering: scene.rendering ?? null,
        },
        rendering: scene.rendering,
        detail,
        ...(nodeTypes ? { nodeTypes } : {}),
        toleranceM: measurementToleranceM,
      })
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}
