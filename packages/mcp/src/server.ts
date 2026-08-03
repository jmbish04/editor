import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneBridge } from './bridge/scene-bridge'
import { createSceneOperations, type SceneOperations } from './operations'
import { registerPrompts } from './prompts'
import { registerResources } from './resources'
import type { SceneStore } from './storage/types'
import { registerTools } from './tools'
import type { CloudflareScreenshotToolOptions } from './tools/capture-scene-screenshot'
import { registerVisionTools } from './tools/vision'

export type CreatePascalMcpServerOptions = {
  bridge: SceneBridge
  operations?: SceneOperations
  /** Required for persistence tools. Hosted apps and CLIs inject their own store. */
  store?: SceneStore
  name?: string
  version?: string
  /** Optional Cloudflare Browser Rendering/Images configuration for screenshot tools. */
  cloudflare?: CloudflareScreenshotToolOptions
}

export function createPascalMcpServer(opts: CreatePascalMcpServerOptions): McpServer {
  const server = new McpServer({
    name: opts.name ?? 'pascal-mcp',
    version: opts.version ?? '0.1.0',
  })
  const operations =
    opts.operations ?? createSceneOperations({ bridge: opts.bridge, store: opts.store })
  registerTools(server, operations, { cloudflare: opts.cloudflare })
  registerVisionTools(server, operations)
  registerResources(server, operations)
  registerPrompts(server, operations)
  return server
}
