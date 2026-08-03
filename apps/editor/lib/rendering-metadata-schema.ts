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
  geometry: z
    .object({
      basis: z.enum(['measured-rectangle-bbox-placement', 'pascal-refined', 'imported']),
      sourceDetail: z.enum([
        'room-percent-boxes-and-measured-sizes',
        'field-verified-coordinates',
        'unknown',
      ]),
      provisionalElements: z.array(z.string().min(1).max(200)).max(1_000),
      validatedAt: z.iso.datetime().nullable(),
    })
    .optional(),
})
