import { z } from 'zod';

export const hexSchema = z.templateLiteral(['0x', z.string().regex(/^[0-9a-fA-F]*$/)]);
export const addressSchema = z.templateLiteral(['0x', z.string().regex(/^[0-9a-fA-F]{40}$/)]);
