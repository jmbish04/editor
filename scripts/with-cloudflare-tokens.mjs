import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const command = process.argv.slice(2)
if (command.length === 0) {
  console.error('usage: node scripts/with-cloudflare-tokens.mjs <command> [args...]')
  process.exit(2)
}

const homeTokens = path.join(homedir(), 'bin', 'tokens')
const tokensBin = process.env.TOKENS_BIN ?? (existsSync(homeTokens) ? homeTokens : 'tokens')
const env = { ...process.env }

function loadToken(key) {
  const result = spawnSync(tokensBin, ['show', key, '--value-only'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const value = result.stdout?.trim()
  if (result.status !== 0 || !value) {
    console.error(`unable to load ${key} from tokens`)
    process.exit(1)
  }
  return value
}

for (const key of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_WRANGLER_API_TOKEN']) {
  if (!env[key]) env[key] = loadToken(key)
}

env.CORE_REMODEL_API_URL ??= 'https://core-remodel.hacolby.workers.dev'

if (!env.CORE_REMODEL_API_TOKEN || !env.PASCAL_SCENE_API_TOKEN) {
  const workerApiKey = loadToken('WORKER_API_KEY')
  env.CORE_REMODEL_API_TOKEN ||= workerApiKey
  env.PASCAL_SCENE_API_TOKEN ||= workerApiKey
}

const child = spawnSync(command[0], command.slice(1), { env, stdio: 'inherit' })
if (child.error) {
  console.error(child.error.message)
  process.exit(1)
}
process.exit(child.status ?? 1)
