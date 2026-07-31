/**
 * Environment variable validation for the editor app.
 *
 * This file validates environment variables used by the standalone editor app.
 * Values are loaded from the repo root .env.local by package scripts.
 *
 * @see https://env.t3.gg/docs/nextjs
 */
import { createEnv } from '@t3-oss/env-nextjs'
import { z } from 'zod'

export const env = createEnv({
  /**
   * Server-side environment variables (not exposed to client)
   */
  server: {
    CORE_REMODEL_API_URL: z.string().url().optional(),
    CORE_REMODEL_API_TOKEN: z.string().min(1).optional(),
    PASCAL_SCENE_API_TOKEN: z.string().min(1).optional(),
    CLOUDFLARE_ACCOUNT_ID: z.string().min(1).optional(),
    CLOUDFLARE_WRANGLER_API_TOKEN: z.string().min(1).optional(),
    PASCAL_EDITOR_BASE_URL: z.string().url().optional(),
  },

  /**
   * Client-side environment variables (exposed to browser via NEXT_PUBLIC_)
   */
  client: {
    NEXT_PUBLIC_ASSETS_CDN_URL: z.string().optional(),
  },

  /**
   * Runtime values - pulls from process.env
   */
  runtimeEnv: {
    CORE_REMODEL_API_URL: process.env.CORE_REMODEL_API_URL,
    CORE_REMODEL_API_TOKEN: process.env.CORE_REMODEL_API_TOKEN,
    PASCAL_SCENE_API_TOKEN: process.env.PASCAL_SCENE_API_TOKEN,
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_WRANGLER_API_TOKEN: process.env.CLOUDFLARE_WRANGLER_API_TOKEN,
    PASCAL_EDITOR_BASE_URL: process.env.PASCAL_EDITOR_BASE_URL,
    NEXT_PUBLIC_ASSETS_CDN_URL:
      process.env.NEXT_PUBLIC_ASSETS_CDN_URL ?? process.env.NEXT_PUBLIC_EDITOR_ASSETS_CDN_URL,
  },

  /**
   * Skip validation during build (env vars come from Vercel at runtime)
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
})
