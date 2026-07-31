export const installCommand = 'pnpm add agents @modelcontextprotocol/server@2.0.0 zod'

export const environmentConfig = `// wrangler.jsonc — Core Remodel Worker bindings
{
  "vars": {
    "PASCAL_EDITOR_URL": "https://YOUR_EDITOR.vercel.app",
    "CLOUDFLARE_ACCOUNT_ID": "<account-id>"
  },
  "secrets_store_secrets": [
    { "binding": "PASCAL_SCENE_API_TOKEN", "store_id": "<store-id>", "secret_name": "WORKER_API_KEY" },
    { "binding": "CLOUDFLARE_WRANGLER_API_TOKEN", "store_id": "<store-id>", "secret_name": "CLOUDFLARE_WRANGLER_API_TOKEN" }
  ]
}`

export const workerScaffold = `import { McpServer } from '@modelcontextprotocol/server'
import { createMcpHandler } from 'agents/mcp/server'
import { z } from 'zod'

type Env = {
  PASCAL_EDITOR_URL: string
  PASCAL_SCENE_API_TOKEN: { get(): Promise<string> }
  CLOUDFLARE_ACCOUNT_ID: string
  CLOUDFLARE_WRANGLER_API_TOKEN: { get(): Promise<string> }
}

function createPascalServer(env: Env, request: Request) {
  const server = new McpServer({
    name: 'core-remodel-pascal',
    version: '1.0.0',
  })

  server.registerTool('list_project_scenes', {
    description: 'List Pascal rendering scenes mapped to an authorized Core Remodel project.',
    inputSchema: { projectId: z.string().min(1), limit: z.number().int().max(100).default(50) },
  }, async ({ projectId, limit }) => {
    await assertProjectAccess(request, env, projectId)
    return jsonToolResult(await pascalRequest(env,
      \`/api/projects/\${encodeURIComponent(projectId)}/scenes?limit=\${limit}\`))
  })

  server.registerTool('sync_project_scene', {
    description: 'Push or pull a Pascal scene while preserving project identity and provenance.',
    inputSchema: {
      projectId: z.string().min(1),
      payload: z.record(z.string(), z.unknown()),
    },
  }, async ({ projectId, payload }) => {
    await assertProjectAccess(request, env, projectId)
    return jsonToolResult(await pascalRequest(env,
      \`/api/projects/\${encodeURIComponent(projectId)}/sync\`, payload))
  })

  server.registerTool('get_project_geometry', {
    description: 'Return exact Pascal nodes, coordinates, dimensions, provenance, and measured-bounds validation.',
    inputSchema: {
      projectId: z.string().min(1),
      sceneId: z.string().min(1),
      detail: z.enum(['summary', 'full']).default('full'),
    },
  }, async ({ projectId, sceneId, detail }) => {
    await assertProjectAccess(request, env, projectId)
    const pulled = await pascalRequest(env,
      \`/api/projects/\${encodeURIComponent(projectId)}/sync\`,
      { direction: 'pull', sceneId })
    return jsonToolResult(projectGeometryPayload(pulled, detail))
  })

  registerCaptureSceneScreenshot(server, env, request)
  return server
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const handler = createMcpHandler(
      () => createPascalServer(env, request),
      { route: '/mcp' },
    )
    return handler(request, env, ctx)
  },
} satisfies ExportedHandler<Env>`

export const adapterHelper = `type PascalGraph = {
  nodes: Record<string, { id: string; type: string; parentId?: string; [key: string]: unknown }>
  rootNodeIds: string[]
  collections?: Record<string, unknown>
}

function projectGeometryPayload(pulled: unknown, detail: 'summary' | 'full') {
  const scene = pulled as { graph: PascalGraph; rendering?: unknown }
  const nodes = Object.values(scene.graph.nodes)
  const withFrame = (node: PascalGraph['nodes'][string]) => ({
    ...node,
    coordinateFrame:
      node.type === 'building'
        ? 'site-local'
        : node.type === 'level'
          ? 'building-local'
          : node.type === 'door' || node.type === 'window'
        ? 'host-local'
        : node.type === 'item'
          ? 'parent-local'
          : 'level-local',
    levelId: ['wall', 'zone', 'slab', 'ceiling'].includes(node.type)
      ? node.parentId ?? null
      : undefined,
  })
  return {
    scene: pulled,
    coordinateSystem: {
      units: 'meters', floorPlane: ['x', 'z'], verticalAxis: 'y',
      wallZoneSurfaceCoordinates: 'level-local [x,z]',
      openingCoordinates: 'host-local [x,y,z]',
      itemCoordinates: 'parent-local [x,y,z]',
    },
    geometry: {
      buildings: nodes.filter((node) => node.type === 'building').map(withFrame),
      levels: nodes.filter((node) => node.type === 'level').map(withFrame),
      walls: nodes.filter((node) => node.type === 'wall').map(withFrame),
      zones: nodes.filter((node) => node.type === 'zone').map(withFrame),
      openings: nodes.filter((node) => node.type === 'door' || node.type === 'window').map(withFrame),
      surfaces: nodes.filter((node) => node.type === 'slab' || node.type === 'ceiling').map(withFrame),
      items: nodes.filter((node) => node.type === 'item').map(withFrame),
    },
    ...(detail === 'full' ? { nodes: scene.graph.nodes } : {}),
  }
}

async function pascalRequest(env: Env, path: string, body?: unknown) {
  const sceneApiToken = await env.PASCAL_SCENE_API_TOKEN.get()
  const response = await fetch(new URL(path, env.PASCAL_EDITOR_URL), {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: \`Bearer \${sceneApiToken}\`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const payload = await response.json()
  if (!response.ok) throw new Error(\`Pascal API failed (\${response.status})\`)
  return payload
}

function jsonToolResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    structuredContent: payload as Record<string, unknown>,
  }
}`

export const geometryContract = `Geometry honesty

Core Remodel source truth
- Exact measured width/depth for each room
- Relative per-room percent box
- No field-verified wall endpoints or opening coordinates

Deterministic base
1. seed_measured_rooms creates exact measured rectangles.
2. Percent boxes control relative placement only.
3. Generated walls, adjacency, and openings are marked provisional.
4. Every generated node retains sourceRoomId, box, measurement IDs, and confidence.

Granular model access
- get_project_geometry returns raw nodes plus levels, [x,z] wall endpoints, wall-local openings,
  zone polygons, surfaces, furniture transforms, dimensions, provenance, and validation.
- get_scene, get_node, get_walls, get_zones, find_nodes, measure, and query_spatial remain available.
- validate_measured_geometry reports exact width/depth deltas after AI edits.
- Validation covers the zone, slab, ceiling, and four-wall loop; missing evidence is not applicable.

Coordinate system
- meters; X/Z floor plane; Y vertical
- wall/zone/slab/ceiling geometry: level-local [x,z] with levelId
- building position/rotation: site-local transform used to compose world coordinates
- door/window position: host-local [x,y,z] with wallId or roofSegmentId/roofFace`

export const geometryAdapterMapping = `Worker adapter mapping

- seed_measured_rooms: authorize projectId, pull the scene graph, apply deterministic measured-room
  node creation, then push the graph through /api/projects/:projectId/sync with provenance intact.
- get_project_geometry: authorize, pull, return categorized nodes with explicit coordinate frames;
  include raw nodes for detail=full and derive honesty from scene/node evidence only.
- validate_measured_geometry: authorize, pull, group measured-derived nodes by sourceRoomId, validate
  zone + slab + ceiling + four-wall loop, and return not_applicable when no evidence exists.
- Never expose a generic unscoped sceneId lookup from the Worker; project authorization happens first.`

export const screenshotContract = `capture_scene_screenshot

Input
- sceneId: Pascal scene ID
- projectId: Core Remodel project ID
- width: 320..3840 (default 1440)
- height: 240..2160 (default 900)
- fullPage: boolean
- setAsThumbnail: boolean (default true)

Required behavior
1. Authorize access to projectId in Core Remodel.
2. Render PASCAL_EDITOR_URL/scene/:sceneId with Browser Rendering.
3. Reject empty, non-image, or >10 MB responses.
4. Upload multipart file to Cloudflare Images; do not set Content-Type manually.
5. Read result.id and result.variants from the upload response.
6. If setAsThumbnail, push the public variant URL through Pascal's sync API.
7. Preserve coreRemodelProjectId, variantId, measurements, confidence, and provenance.
8. Return imageId, variants, deliveryUrl, capturedUrl, sceneId, and sceneVersion.`

export const codingAgentBrief = `Implement a stateless Pascal rendering MCP facade inside the existing Core Remodel Cloudflare Worker.

Constraints:
- Keep the application as one Worker and mount Streamable HTTP at /mcp.
- Use agents/mcp/server createMcpHandler and @modelcontextprotocol/server v2.
- Create a fresh MCP server per request.
- Core Remodel remains the system of record for users, organizations, projects, facts, permissions, and billing.
- Pascal owns scene graph, geometry, variants, rendering state, and visual editing.
- Core Remodel room data has measured sizes and percent boxes, not wall coordinates. Never invent source precision.
- Register seed_measured_rooms, get_project_geometry, and validate_measured_geometry.
- Expose raw Pascal nodes and granular coordinate tools when the model requests full detail.
- Every tool accepting projectId must call the existing Core Remodel authorization layer before Pascal.
- Use the Pascal Vercel APIs under /api/projects/:projectId/scenes and /sync.
- Add capture_scene_screenshot using Cloudflare Browser Rendering and Cloudflare Images.
- Do not import Pascal's Bun CLI, Node HTTP transport, or SQLite store into the Worker.
- Keep WORKER_API_KEY and Cloudflare credentials in Worker secrets; never expose them to MCP clients.
- Add unique OpenAPI operationIds and module health checks for all non-MCP HTTP routes.

Acceptance:
- MCP Inspector connects to /mcp and lists project scene, sync, measured seed, geometry, validation, and screenshot tools.
- Unauthorized projects fail before any request reaches Pascal.
- Scene push/pull preserves project identity, variant metadata, measurements, confidence, and provenance.
- Measured-room seeds use exact dimensions, bbox-only placement, and provisional wall metadata.
- Full geometry includes raw nodes, wall endpoints, opening positions, polygons, transforms, and measured-bound deltas.
- Screenshot capture produces a Cloudflare Images delivery URL and can update the scene thumbnail.
- Focused tests cover auth rejection, Pascal upstream failure, version conflict, screenshot upload, and metadata preservation.
- wrangler types, typecheck, tests, and deployment dry-run pass.`
