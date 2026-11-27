/**
 * Plain JSON Schemas. The same object configures the cloud model (`responseSchema`)
 * and Gemini Nano (`responseConstraint`), so both routes return the same shape.
 */
export const READ_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    legibility: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['text', 'legibility'],
} as const;

export const ANALYZE_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['board', 'formula', 'exercise', 'question', 'other'] },
    title: { type: 'string' },
    subject: { type: 'string' },
    topic: { type: 'string' },
    teaches: { type: 'array', items: { type: 'string' } },
    teaches_en: { type: 'array', items: { type: 'string' } },
    needs_en: { type: 'array', items: { type: 'string' } },
    needs_review: { type: 'boolean' },
  },
  required: ['kind', 'title', 'subject', 'topic', 'teaches', 'teaches_en', 'needs_en', 'needs_review'],
} as const;

export const HELP_SCHEMA = {
  type: 'object',
  properties: {
    help: { type: 'string' },
    source_id: { type: 'string' },
    connection: { type: 'string' },
    practice_q: { type: 'string' },
    practice_a: { type: 'string' },
    // Full solutions only: the method in a few words, and the picture the device should draw.
    plan: { type: 'string' },
    visual: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['none', 'graph', 'intersection', 'area', 'tangent', 'unit_circle', 'parametric'] },
        f: { type: 'string' },
        g: { type: 'string' },
        a: { type: 'string' },
        b: { type: 'string' },
      },
      required: ['kind', 'f', 'g', 'a', 'b'],
    },
  },
  required: ['help', 'source_id', 'connection', 'practice_q', 'practice_a'],
} as const;
