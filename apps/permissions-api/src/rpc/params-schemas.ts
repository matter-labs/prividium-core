import { z } from 'zod/v4';

export const anyParams = z.array(z.unknown());

export type AnyParams = typeof anyParams;
