export const installCommand = 'pnpm add agents @modelcontextprotocol/server@2.0.0 zod'

export const environmentConfig = `# Core Remodel Worker: server-only bindings
PASCAL_EDITOR_URL=https://YOUR_EDITOR.vercel.app

# Add these with wrangler secret put; never commit their values
PASCAL_SCENE_API_TOKEN=<WORKER_API_KEY>
CLOUDFLARE_ACCOUNT_ID=<account-id>
CLOUDFLARE_WRANGLER_API_TOKEN=<api-token>`

export const workerScaffold = `import { McpServer } from '@modelcontextprotocol/server'
import { createMcpHandler } from 'agents/mcp/server'
import { z } from 'zod'

type Env = {
  PASCAL_EDITOR_URL: string
  PASCAL_SCENE_API_TOKEN: string
  CLOUDFLARE_ACCOUNT_ID: string
  CLOUDFLARE_WRANGLER_API_TOKEN: string
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

export const adapterHelper = `async function pascalRequest(env: Env, path: string, body?: unknown) {
  const response = await fetch(new URL(path, env.PASCAL_EDITOR_URL), {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: \`Bearer \${env.PASCAL_SCENE_API_TOKEN}\`,
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
- Every tool accepting projectId must call the existing Core Remodel authorization layer before Pascal.
- Use the Pascal Vercel APIs under /api/projects/:projectId/scenes and /sync.
- Add capture_scene_screenshot using Cloudflare Browser Rendering and Cloudflare Images.
- Do not import Pascal's Bun CLI, Node HTTP transport, or SQLite store into the Worker.
- Keep WORKER_API_KEY and Cloudflare credentials in Worker secrets; never expose them to MCP clients.
- Add unique OpenAPI operationIds and module health checks for all non-MCP HTTP routes.

Acceptance:
- MCP Inspector connects to /mcp and lists the three tools.
- Unauthorized projects fail before any request reaches Pascal.
- Scene push/pull preserves project identity, variant metadata, measurements, confidence, and provenance.
- Screenshot capture produces a Cloudflare Images delivery URL and can update the scene thumbnail.
- Focused tests cover auth rejection, Pascal upstream failure, version conflict, screenshot upload, and metadata preservation.
- wrangler types, typecheck, tests, and deployment dry-run pass.`
