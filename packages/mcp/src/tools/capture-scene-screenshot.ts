import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { ErrorCode, McpError, throwMcpError } from './errors'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_METADATA_BYTES = 1024
const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4'

export interface CloudflareScreenshotToolOptions {
  accountId?: string
  apiToken?: string
  editorBaseUrl?: string
  allowedCaptureOrigins?: string[]
  fetch?: typeof fetch
  now?: () => Date
}

type CloudflareImagesResponse = {
  success?: boolean
  errors?: Array<{ code?: number; message?: string }>
  result?: {
    id?: string
    filename?: string
    uploaded?: string
    requireSignedURLs?: boolean
    variants?: string[]
  }
}

export const captureSceneScreenshotInput = {
  sceneId: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe('Stored Pascal scene id. Used to derive the editor URL and update its thumbnail.'),
  url: z
    .string()
    .url()
    .optional()
    .describe(
      'Explicit public editor/page URL on a configured capture origin. Required when sceneId cannot be resolved.',
    ),
  projectId: z.string().min(1).max(200).optional(),
  width: z.number().int().min(320).max(3840).default(1440),
  height: z.number().int().min(240).max(2160).default(900),
  deviceScaleFactor: z.number().min(1).max(3).default(1),
  fullPage: z.boolean().default(false),
  waitUntil: z
    .enum(['load', 'domcontentloaded', 'networkidle0', 'networkidle2'])
    .default('networkidle0'),
  timeoutMs: z.number().int().min(1000).max(60_000).default(45_000),
  imageId: z.string().min(1).max(1024).optional(),
  requireSignedURLs: z.boolean().default(false),
  setAsThumbnail: z
    .boolean()
    .default(true)
    .describe('When sceneId is present, save the public Cloudflare Images URL as its thumbnail.'),
  metadata: z.record(z.string(), z.string()).optional(),
}

export const captureSceneScreenshotOutput = {
  imageId: z.string(),
  filename: z.string(),
  uploadedAt: z.string().nullable(),
  requireSignedURLs: z.boolean(),
  variants: z.array(z.string().url()),
  deliveryUrl: z.string().url().nullable(),
  capturedUrl: z.string().url(),
  sceneId: z.string().nullable(),
  sceneVersion: z.number().int().positive().nullable(),
  width: z.number().int(),
  height: z.number().int(),
}

function envOptions(): CloudflareScreenshotToolOptions {
  return {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_WRANGLER_API_TOKEN,
    editorBaseUrl: process.env.PASCAL_EDITOR_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL,
    allowedCaptureOrigins: process.env.PASCAL_CAPTURE_ALLOWED_ORIGINS?.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  }
}

function allowedOrigins(
  editorBaseUrl: string | undefined,
  configuredOrigins: string[] | undefined,
): Set<string> {
  const origins = new Set<string>()
  for (const candidate of [editorBaseUrl, ...(configuredOrigins ?? [])]) {
    if (!candidate) continue
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('capture origins must use http or https')
    }
    origins.add(parsed.origin)
  }
  return origins
}

function resolveCaptureUrl(
  url: string | undefined,
  sceneId: string | undefined,
  editorBaseUrl: string | undefined,
  configuredOrigins: string[] | undefined,
): string {
  const origins = allowedOrigins(editorBaseUrl, configuredOrigins)
  if (url) {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('url must use http or https')
    }
    if (!origins.has(parsed.origin)) {
      throw new Error(
        'url origin is not allowed; configure PASCAL_EDITOR_BASE_URL or PASCAL_CAPTURE_ALLOWED_ORIGINS',
      )
    }
    return parsed.toString()
  }
  if (!(sceneId && editorBaseUrl)) {
    throw new Error('pass url, or pass sceneId and configure PASCAL_EDITOR_BASE_URL')
  }
  const base = new URL(editorBaseUrl)
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new Error('PASCAL_EDITOR_BASE_URL must use http or https')
  }
  return new URL(`/scene/${encodeURIComponent(sceneId)}`, base).toString()
}

async function responseError(response: Response): Promise<string> {
  const fallback = `Cloudflare API request failed (${response.status})`
  try {
    const payload = (await response.json()) as CloudflareImagesResponse
    return (
      payload.errors
        ?.map((error) => error.message)
        .filter(Boolean)
        .join('; ') || fallback
    )
  } catch {
    return fallback
  }
}

function validHttpUrls(values: string[]): string[] {
  return values.flatMap((value) => {
    try {
      const parsed = new URL(value)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? [parsed.toString()] : []
    } catch {
      return []
    }
  })
}

function preferredVariant(variants: string[]): string | null {
  return (
    variants.find((variant) => /\/(?:public|original)$/.test(new URL(variant).pathname)) ??
    variants[0] ??
    null
  )
}

export function registerCaptureSceneScreenshot(
  server: McpServer,
  operations: SceneOperations,
  configuredOptions: CloudflareScreenshotToolOptions = {},
): void {
  const options = { ...envOptions(), ...configuredOptions }

  server.registerTool(
    'capture_scene_screenshot',
    {
      title: 'Capture scene screenshot to Cloudflare Images',
      description:
        'Render a Pascal scene/editor URL with Cloudflare Browser Rendering, upload the resulting PNG to Cloudflare Images, and optionally store its delivery URL as the scene thumbnail.',
      inputSchema: captureSceneScreenshotInput,
      outputSchema: captureSceneScreenshotOutput,
    },
    async ({
      sceneId,
      url,
      projectId,
      width,
      height,
      deviceScaleFactor,
      fullPage,
      waitUntil,
      timeoutMs,
      imageId,
      requireSignedURLs,
      setAsThumbnail,
      metadata,
    }) => {
      if (!(options.accountId && options.apiToken)) {
        throwMcpError(
          ErrorCode.InvalidRequest,
          'cloudflare_images_unconfigured: set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_WRANGLER_API_TOKEN',
        )
      }
      if (setAsThumbnail && sceneId && requireSignedURLs) {
        throwMcpError(
          ErrorCode.InvalidParams,
          'setAsThumbnail requires a public image; set requireSignedURLs to false',
        )
      }

      const fetchImpl = options.fetch ?? globalThis.fetch
      const now = options.now?.() ?? new Date()
      let storedScene = null

      try {
        if (setAsThumbnail && sceneId) {
          if (!operations.hasStore) {
            throwMcpError(ErrorCode.InvalidRequest, 'scene_store_unavailable')
          }
          storedScene = await operations.loadStoredScene(sceneId)
          if (!storedScene) {
            throwMcpError(ErrorCode.InvalidParams, 'scene_not_found', { sceneId })
          }
          const mappedProjectId =
            storedScene.rendering?.coreRemodelProjectId ?? storedScene.projectId
          if (projectId && mappedProjectId !== projectId) {
            throwMcpError(ErrorCode.InvalidRequest, 'project_identity_mismatch', {
              projectId,
              mappedProjectId,
              sceneId,
            })
          }
        }

        const capturedUrl = resolveCaptureUrl(
          url,
          sceneId,
          options.editorBaseUrl,
          options.allowedCaptureOrigins,
        )
        const authHeaders = {
          Authorization: `Bearer ${options.apiToken}`,
          'Content-Type': 'application/json',
        }
        const screenshotResponse = await fetchImpl(
          `${CLOUDFLARE_API_BASE}/accounts/${encodeURIComponent(options.accountId)}/browser-rendering/screenshot`,
          {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
              url: capturedUrl,
              screenshotOptions: { fullPage, type: 'png' },
              viewport: { width, height, deviceScaleFactor },
              gotoOptions: { waitUntil, timeout: timeoutMs },
            }),
          },
        )
        if (!screenshotResponse.ok) throw new Error(await responseError(screenshotResponse))

        const contentType = screenshotResponse.headers.get('content-type')?.split(';')[0]
        if (!contentType?.startsWith('image/')) {
          throw new Error(`Browser Rendering returned ${contentType ?? 'an unknown content type'}`)
        }
        const screenshot = await screenshotResponse.arrayBuffer()
        if (screenshot.byteLength === 0)
          throw new Error('Browser Rendering returned an empty image')
        if (screenshot.byteLength > MAX_IMAGE_BYTES) {
          throw new Error(`Screenshot exceeds the Cloudflare Images ${MAX_IMAGE_BYTES}-byte limit`)
        }

        const filename = `pascal-${sceneId ?? 'capture'}-${now.toISOString().replace(/[:.]/g, '-')}.png`
        const imageMetadata = {
          source: 'pascal-mcp',
          capturedUrl,
          capturedAt: now.toISOString(),
          ...(sceneId ? { sceneId } : {}),
          ...(projectId ? { projectId } : {}),
          ...(metadata ?? {}),
        }
        const serializedMetadata = JSON.stringify(imageMetadata)
        if (new TextEncoder().encode(serializedMetadata).byteLength > MAX_METADATA_BYTES) {
          throw new Error(`Cloudflare Images metadata exceeds ${MAX_METADATA_BYTES} bytes`)
        }

        const form = new FormData()
        form.set('file', new Blob([screenshot], { type: contentType }), filename)
        form.set('metadata', serializedMetadata)
        form.set('requireSignedURLs', String(requireSignedURLs))
        if (imageId) form.set('id', imageId)

        const uploadResponse = await fetchImpl(
          `${CLOUDFLARE_API_BASE}/accounts/${encodeURIComponent(options.accountId)}/images/v1`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${options.apiToken}` },
            body: form,
          },
        )
        if (!uploadResponse.ok) throw new Error(await responseError(uploadResponse))

        const uploaded = (await uploadResponse.json()) as CloudflareImagesResponse
        if (!(uploaded.success && uploaded.result?.id)) {
          throw new Error(
            uploaded.errors
              ?.map((error) => error.message)
              .filter(Boolean)
              .join('; ') || 'Cloudflare Images returned an invalid upload response',
          )
        }
        const variants = validHttpUrls(uploaded.result.variants ?? [])
        const deliveryUrl = preferredVariant(variants)
        let sceneVersion: number | null = null

        if (setAsThumbnail && sceneId && storedScene) {
          if (!deliveryUrl) throw new Error('Cloudflare Images returned no delivery URL')
          const saved = await operations.saveScene({
            id: storedScene.id,
            name: storedScene.name,
            projectId: storedScene.projectId,
            ownerId: storedScene.ownerId,
            graph: storedScene.graph,
            thumbnailUrl: deliveryUrl,
            expectedVersion: storedScene.version,
            rendering: storedScene.rendering,
            saveMode: 'draft',
            operation: 'capture_scene_screenshot',
          })
          sceneVersion = saved.version
        }

        const payload = {
          imageId: uploaded.result.id,
          filename: uploaded.result.filename ?? filename,
          uploadedAt: uploaded.result.uploaded ?? null,
          requireSignedURLs: uploaded.result.requireSignedURLs ?? requireSignedURLs,
          variants,
          deliveryUrl,
          capturedUrl,
          sceneId: sceneId ?? null,
          sceneVersion,
          width,
          height,
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          structuredContent: payload,
        }
      } catch (error) {
        if (error instanceof McpError) throw error
        throwMcpError(ErrorCode.InternalError, 'cloudflare_screenshot_failed', {
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    },
  )
}
