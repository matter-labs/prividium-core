import { type Address, getAddress } from 'viem';
import * as z from 'zod/v4';

export const addressSchema = z
    .templateLiteral(['0x', z.string().regex(/[0-9a-fA-F]{40}/)])
    .transform((addr): Address => getAddress(addr));
