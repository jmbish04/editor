export function GET() {
  return Response.json({
    status: 'ok',
    app: 'editor',
    sceneStore: process.env.CORE_REMODEL_API_URL ? 'core-remodel' : 'sqlite',
    runtime: process.env.VERCEL ? 'vercel' : 'local',
    timestamp: new Date().toISOString(),
  })
}
