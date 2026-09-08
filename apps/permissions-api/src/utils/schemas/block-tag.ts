import { z } from 'zod/v4';
import { hexSchema } from './hex-schema';

export const blockTagSchema = z.union([
    hexSchema,
    z.literal('earliest'),
    z.literal('latest'),
    z.literal('safe'),
    z.literal('finalized'),
    z.literal('pending')
]);

export type BlockTag = z.infer<typeof blockTagSchema>;
