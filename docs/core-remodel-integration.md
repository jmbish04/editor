# Core Remodel integration contract

Pascal is the rendering and visual-editing client. Core Remodel remains the system of record for
users, organizations, projects, remodel requirements, measurements, materials, permissions,
billing, and structural constraints.

## Identity and metadata

Every integrated Pascal scene carries both `projectId` and
`rendering.coreRemodelProjectId`; they must match at API boundaries. Rendering metadata contains:

- variant identity, label, and parent-scene lineage;
- immutable measurement evidence snapshots with the authoritative Core Remodel measurement ID,
  source revision, unit, value, and confidence;
- aggregate generation confidence;
- source, generation timestamp, source revision, and request ID provenance.

These snapshots explain how a scene was generated. Updating them does not update the corresponding
Core Remodel business records.

## Vercel storage selection

The editor selects the remote adapter when `CORE_REMODEL_API_URL` is set. Set
`CORE_REMODEL_API_TOKEN` for bearer authentication. Without the URL, Pascal retains its existing
local SQLite behavior for local development and MCP clients.

Vercel must use the remote adapter because its function filesystem is ephemeral. Configure both
values as server-only Vercel environment variables; neither is exposed to browser bundles.

## Core Remodel API expected by Pascal

`CORE_REMODEL_API_URL` is the Core Remodel origin. Pascal calls these routes below
`/api/pascal/v1`:

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/projects` | Create a project mapping when the caller is authorized |
| `GET` | `/projects/:projectId` | Read project/rendering status |
| `GET` | `/scenes?projectId=...` | List scenes for a Core Remodel project |
| `PUT` | `/scenes/:sceneId` | Create or version-update a scene |
| `GET` | `/scenes/:sceneId` | Load scene graph and metadata |
| `PATCH` | `/scenes/:sceneId` | Rename a scene |
| `DELETE` | `/scenes/:sceneId` | Delete rendering state, subject to Core Remodel authorization |
| `POST` | `/scenes/:sceneId/events` | Append a browser-visible scene event |
| `GET` | `/scenes/:sceneId/events` | Read events after a cursor |

The API returns the Pascal `SceneMeta`, `SceneWithGraph`, `ProjectStatus`, and `SceneEvent` shapes.
Version conflicts return `409` or `412`, missing resources return `404`, invalid payloads return
`400` or `422`, and oversized scenes return `413`.

## Pascal synchronization API

External orchestrators can use the protected editor APIs:

- `GET /api/projects/:projectId/scenes` lists scenes mapped to the project.
- `POST /api/projects/:projectId/scenes` creates or updates a project scene.
- `POST /api/projects/:projectId/sync` with `direction: "push"` writes a complete graph and its
  rendering metadata; `direction: "pull"` loads one scene after verifying project identity.

The existing `PASCAL_SCENE_API_TOKEN`, origin checks, CORS policy, rate limiting, and optimistic
version behavior apply to these routes.

## Screenshot capture and Cloudflare Images

The MCP tool `capture_scene_screenshot` renders either an explicit URL or
`PASCAL_EDITOR_BASE_URL/scene/:sceneId` through Cloudflare Browser Rendering, uploads the resulting
PNG to Cloudflare Images, and returns the image ID, delivery URL, and every configured variant URL.
When a scene ID is supplied, the public delivery URL is saved as that scene's thumbnail by default.

The tool requires `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_WRANGLER_API_TOKEN`. The API token needs
`Browser Rendering - Edit` and Cloudflare Images write permission. The Images delivery hash is not
required because the upload response provides complete variant URLs.

For local processes, `bun run dev:tokens` and `bun run mcp:tokens` set
`CORE_REMODEL_API_URL=https://core-remodel.hacolby.workers.dev`, load `WORKER_API_KEY` once from
`~/bin/tokens`, and expose it to the child process as both `CORE_REMODEL_API_TOKEN` and
`PASCAL_SCENE_API_TOKEN`. The same wrapper also loads the Cloudflare account and API token. It does
not print secrets or write an `.env.local` file. Set the equivalent variables as server-only Vercel
environment variables in deployed environments.
