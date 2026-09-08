/** biome-ignore-all lint/suspicious/noExplicitAny: This document contains code that will be serialized and executed as js code. */

import { z } from 'zod/v4';
import { hexSchema } from '../../../utils/schemas/hex-schema';

export const tracerStr = `{
    prevTop: null,
    state: {
        reads: {}, addresses: {}, success: null, value: null
    },
    step: function (log, _db) {
        const addr = log.contract.getAddress();

        // Save every address which bytecode was excecuted. Adresses object used as a string set.
        this.state.addresses[addr] = true;

        if (log.op.toString() === 'SLOAD') {
            const slot = this.prevTop;
            if (!this.state.reads[addr]) this.state.reads[addr] = [];
            if (this.state.reads[addr].indexOf(slot) === -1) this.state.reads[addr].push(slot);
        }

        if (log.stack.length() > 0) {
            this.prevTop = log.stack.peek(0).toString(16);
        } else {
            this.prevTop = null;
        }
    },
    fault: (_log, _db) => {},
    result: function (ctx, _db) {
        this.state.success = ctx.error === null;
        this.state.value = ctx.output.toString('hex');
        this.state.addresses = Object.keys(this.state.addresses);
        return this.state;
    }
}`;

export const tracerResultSchema = z.union([
    z.object({ success: z.literal(false) }).loose(),
    z.object({
        success: z.literal(true),
        reads: z.record(hexSchema, z.string().array()),
        addresses: hexSchema.array(),
        value: hexSchema
    })
]);
