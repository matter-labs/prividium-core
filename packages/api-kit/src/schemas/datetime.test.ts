import { describe, expect, it } from 'vitest';
import { isoDatetimeInputSchema } from './datetime';

describe('isoDatetimeInputSchema', () => {
    it.each(['2026-01-01T06:15Z', '2026-01-01T06:15:00Z', '2026-01-01T06:15:00.123Z'])('accepts %s', (value) => {
        expect(isoDatetimeInputSchema().parse(value)).toBe(value);
    });

    it.each(['2026-01-01T06:15+02:00', '2026-01-01T06:15:00.5+02:00'])('accepts %s with an offset', (value) => {
        expect(isoDatetimeInputSchema({ offset: true }).parse(value)).toBe(value);
    });

    it.each([
        '2026-01-01',
        '2026-01-01T06Z',
        '2026-01-01T06:15',
        '2026-01-01T06:15+02:00',
        '2026-02-30T00:00Z'
    ])('rejects %s', (value) => {
        expect(isoDatetimeInputSchema().safeParse(value).success).toBe(false);
    });
});
