import { z } from 'zod/v4';
import { addressSchema } from '../../utils/schemas/address';
import { hexSchema, u256HexSchema } from '../../utils/schemas/hex-schema';

// value is a 0x-hex U256; calldata is 0x-hex ("0x" when empty); deploys are CREATE/CREATE2 addresses
interface TraceFrameInput {
    caller: string;
    callee: string;
    value: string;
    calldata: string;
    deploys: string[];
    callKind: 'call' | 'delegateCall' | 'staticCall' | 'constructor';
    children: TraceFrameInput[];
}

const traceFrameSchema: z.ZodType<TraceFrameInput> = z.object({
    caller: addressSchema,
    callee: addressSchema,
    value: u256HexSchema,
    calldata: hexSchema,
    deploys: z.array(addressSchema),
    callKind: z.enum(['call', 'delegateCall', 'staticCall', 'constructor']),
    children: z.lazy(() => z.array(traceFrameSchema))
});

export const TraceSchema = z.object({
    frame: traceFrameSchema.nullable()
});

export const JudgeRequestSchema = z.object({
    protocolVersion: z.string().min(1),
    trace: TraceSchema,
    accessType: z.enum(['read', 'write'])
});

export const JudgeResponseSchema = z.object({
    allow: z.boolean(),
    ruleId: z.string().optional(),
    reason: z.string().optional(),
    protocolVersion: z.string()
});
