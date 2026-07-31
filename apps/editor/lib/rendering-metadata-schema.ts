import { z } from 'zod'

const nullableText = z.string().min(1).max(500).nullable()

export const sceneRenderingMetadataSchema = z.object({
  coreRemodelProjectId: z.string().min(1).max(200),
  variant: z
    .object({
      id: z.string().min(1).max(200),
      label: z.string().min(1).max(200),
      parentSceneId: z.string().min(1).max(200).nullable(),
    })
    .nullable(),
  measurements: z
    .array(
      z.object({
        measurementId: z.string().min(1).max(200),
        kind: z.string().min(1).max(100),
        value: z.number().finite(),
        unit: z.string().min(1).max(50),
        confidence: z.number().min(0).max(1),
        sourceRevision: nullableText,
      }),
    )
    .max(10_000),
  confidence: z.number().min(0).max(1).nullable(),
  provenance: z.object({
    source: z.enum(['core-remodel', 'pascal', 'import']),
    generatedAt: z.iso.datetime(),
    sourceRevision: nullableText,
    requestId: nullableText,
  }),
})
