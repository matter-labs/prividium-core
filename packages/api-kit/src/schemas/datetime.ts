import * as z from 'zod/v4';

/** ISO 8601 datetime for request input, with seconds optional. */
export function isoDatetimeInputSchema(params: { offset?: boolean } = {}) {
    // zod 4.5+ rejects minute precision; 4.3 accepted it.
    return z.union([z.iso.datetime(params), z.iso.datetime({ ...params, precision: -1 })]);
}
