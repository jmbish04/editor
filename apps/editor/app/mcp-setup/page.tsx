import { ArrowLeft, CheckCircle2, ExternalLink, ShieldCheck, Workflow } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { CodeBlock } from './code-block'
import {
  adapterHelper,
  codingAgentBrief,
  environmentConfig,
  installCommand,
  screenshotContract,
  workerScaffold,
} from './content'

export const metadata: Metadata = {
  title: 'Add Pascal tools to Core Remodel',
  description:
    'Implementation guide for exposing Pascal rendering tools from the Core Remodel Worker.',
}

const sections = [
  ['architecture', 'Architecture'],
  ['worker', 'Worker route'],
  ['screenshot', 'Screenshot tool'],
  ['verify', 'Verify'],
  ['agent-brief', 'Agent brief'],
] as const

const checks = [
  'MCP Inspector connects to the deployed /mcp endpoint.',
  'list_project_scenes returns only scenes mapped to an authorized project.',
  'sync_project_scene rejects a mismatched coreRemodelProjectId.',
  'capture_scene_screenshot returns an Images delivery URL and updates the thumbnail.',
  'Upstream failures and optimistic version conflicts return actionable MCP errors.',
  'wrangler types, typecheck, tests, and deployment dry-run pass.',
]

export default function McpSetupPage() {
  return (
    <div className="min-h-screen bg-background">
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-3 focus:text-primary-foreground"
        href="#content"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-border border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3 sm:px-8">
          <Link
            className="inline-flex min-h-11 items-center gap-2 font-medium text-sm hover:underline"
            href="/scenes"
          >
            <ArrowLeft aria-hidden className="size-4" />
            Scenes
          </Link>
          <span className="font-mono text-muted-foreground text-xs">/mcp-setup</span>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-10 sm:px-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:py-16">
        <aside className="hidden lg:block">
          <nav aria-label="On this page" className="sticky top-24 space-y-1">
            <p className="mb-3 font-semibold text-xs uppercase tracking-wider">On this page</p>
            {sections.map(([id, label]) => (
              <a
                className="flex min-h-11 items-center rounded-md px-3 py-2 text-muted-foreground text-sm hover:bg-accent hover:text-foreground"
                href={`#${id}`}
                key={id}
              >
                {label}
              </a>
            ))}
          </nav>
        </aside>

        <main className="min-w-0" id="content">
          <div className="max-w-3xl">
            <h1 className="text-balance font-bold text-3xl tracking-tight sm:text-5xl">
              Add Pascal tools to Core Remodel
            </h1>
            <p className="mt-5 max-w-[68ch] text-muted-foreground leading-7">
              Expose Pascal scene tools at <code className="font-mono text-foreground">/mcp</code>{' '}
              while Core Remodel keeps project authorization.
            </p>
          </div>

          <section className="scroll-mt-24 pt-14" id="architecture">
            <SectionHeading number="01" title="Preserve the system boundary" />
            <div className="mt-6 overflow-x-auto rounded-lg border border-border bg-card p-5">
              <div
                className="flex min-w-max items-center gap-3 font-medium text-sm"
                role="img"
                aria-label="AI client calls the Core Remodel MCP endpoint, which authorizes the project before calling Pascal APIs and the Pascal scene engine"
              >
                <span className="rounded-md bg-primary px-3 py-2 text-primary-foreground">
                  AI client
                </span>
                <span aria-hidden>→</span>
                <span className="rounded-md border px-3 py-2">Core Remodel /mcp</span>
                <span aria-hidden>→</span>
                <span className="rounded-md border px-3 py-2">Pascal Vercel API</span>
                <span aria-hidden>→</span>
                <span className="rounded-md border px-3 py-2">Scene engine</span>
              </div>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <BoundaryCard
                icon={<ShieldCheck aria-hidden className="size-5" />}
                title="Core Remodel owns"
              >
                Identity, organizations, project facts, permissions, structural constraints,
                materials, billing, and approval.
              </BoundaryCard>
              <BoundaryCard icon={<Workflow aria-hidden className="size-5" />} title="Pascal owns">
                Scene graph, geometry, walls, slabs, zones, openings, furniture, variants, rendering
                state, and visual editing.
              </BoundaryCard>
            </div>
            <p className="mt-5 rounded-lg border border-border bg-muted p-4 text-sm leading-6">
              <strong>Worker rule:</strong> build a stateless façade. Do not import Pascal&apos;s
              Bun CLI, Node HTTP transport, or SQLite store into the Cloudflare Worker.
            </p>
          </section>

          <section className="scroll-mt-24 pt-16" id="worker">
            <SectionHeading number="02" title="Mount the Worker route" />
            <p className="mt-4 max-w-[68ch] text-muted-foreground leading-7">
              Install the current stateless MCP handler, create a fresh server for each request, and
              register project-scoped adapter tools.
            </p>
            <div className="mt-6 space-y-5">
              <CodeBlock code={installCommand} label="Install dependencies" language="bash" />
              <CodeBlock code={environmentConfig} label="Worker environment" language="dotenv" />
              <CodeBlock
                code={workerScaffold}
                label="backend/src/modules/pascal/mcp.ts"
                language="typescript"
              />
              <CodeBlock
                code={adapterHelper}
                label="backend/src/modules/pascal/pascal-client.ts"
                language="typescript"
              />
            </div>
          </section>

          <section className="scroll-mt-24 pt-16" id="screenshot">
            <SectionHeading number="03" title="Register the screenshot tool" />
            <p className="mt-4 max-w-[68ch] text-muted-foreground leading-7">
              Keep the tool name stable so coding agents can discover it without prompt-specific
              aliases. Cloudflare Images returns delivery variants, so no Images delivery hash is
              required.
            </p>
            <div className="mt-6">
              <CodeBlock code={screenshotContract} label="capture_scene_screenshot contract" />
            </div>
          </section>

          <section className="scroll-mt-24 pt-16" id="verify">
            <SectionHeading number="04" title="Verify before deployment" />
            <ul className="mt-6 space-y-3">
              {checks.map((check) => (
                <li className="flex gap-3 text-sm leading-6" key={check}>
                  <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0" />
                  <span>{check}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-wrap gap-3 text-sm">
              <a
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 py-2 font-medium hover:bg-accent"
                href="https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/"
                rel="noreferrer"
                target="_blank"
              >
                Cloudflare remote MCP guide <ExternalLink aria-hidden className="size-4" />
              </a>
              <a
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 py-2 font-medium hover:bg-accent"
                href="https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/"
                rel="noreferrer"
                target="_blank"
              >
                Handler API <ExternalLink aria-hidden className="size-4" />
              </a>
            </div>
          </section>

          <section className="scroll-mt-24 pt-16" id="agent-brief">
            <SectionHeading number="05" title="Hand this brief to the coding agent" />
            <p className="mt-4 max-w-[68ch] text-muted-foreground leading-7">
              Copy this block into the Core Remodel task. It states the ownership rules and
              acceptance criteria without prescribing unrelated refactors.
            </p>
            <div className="mt-6">
              <CodeBlock code={codingAgentBrief} label="Coding agent implementation brief" />
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}

function SectionHeading({ number, title }: { number: string; title: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="font-mono text-muted-foreground text-xs">{number}</span>
      <h2 className="font-semibold text-2xl tracking-tight">{title}</h2>
    </div>
  )
}

function BoundaryCard({
  children,
  icon,
  title,
}: {
  children: React.ReactNode
  icon: React.ReactNode
  title: string
}) {
  return (
    <article className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <h3 className="font-semibold text-sm">{title}</h3>
      </div>
      <p className="mt-3 text-muted-foreground text-sm leading-6">{children}</p>
    </article>
  )
}
