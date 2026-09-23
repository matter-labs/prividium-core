import type { Pool } from 'pg';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDbPool, poolState } from './client';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:notsecurepassword@localhost:5500/postgres';
const logger = { error: () => {} };

describe('createDbPool instrumentation', () => {
    const onQuery = vi.fn<(durationMs: number, outcome: 'ok' | 'error') => void>();
    let pool: Pool;

    beforeAll(async () => {
        pool = createDbPool(DATABASE_URL, logger, false, true, 10_000, 10_000, 2, 5_000, { onQuery });
        await pool.query('select 1');
        return () => pool.end();
    });

    beforeEach(() => {
        onQuery.mockClear();
    });

    it('reports one ok observation for a pool query', async () => {
        const result = await pool.query('select 1 as one');

        expect(result.rows).toEqual([{ one: 1 }]);
        expect(onQuery).toHaveBeenCalledTimes(1);
        expect(onQuery).toHaveBeenCalledWith(expect.any(Number), 'ok');
    });

    it('reports one observation per query on a checked-out client', async () => {
        const client = await pool.connect();
        try {
            const result = await client.query('select 2 as two');
            expect(result.rows).toEqual([{ two: 2 }]);
        } finally {
            client.release();
        }

        expect(onQuery).toHaveBeenCalledTimes(1);
        expect(onQuery).toHaveBeenCalledWith(expect.any(Number), 'ok');
    });

    it('wraps a reused client once', async () => {
        const first = await pool.connect();
        first.release();
        const second = await pool.connect();
        try {
            await second.query('select 3');
        } finally {
            second.release();
        }

        expect(onQuery).toHaveBeenCalledTimes(1);
    });

    it('reports error and rethrows the original error', async () => {
        await expect(pool.query('select * from does_not_exist_xyz')).rejects.toMatchObject({ code: '42P01' });

        expect(onQuery).toHaveBeenCalledTimes(1);
        expect(onQuery).toHaveBeenCalledWith(expect.any(Number), 'error');
    });

    it('leaves the callback form unmeasured', async () => {
        await new Promise<void>((resolve, reject) => {
            pool.query('select 4', (err) => (err ? reject(err) : resolve()));
        });

        expect(onQuery).not.toHaveBeenCalled();
    });

    it('exposes pool counts', () => {
        const state = poolState(pool);

        expect(state.max).toBe(2);
        expect(state.total).toBeGreaterThanOrEqual(1);
        expect(state.active).toBe(state.total - state.idle);
        expect(state.waiting).toBe(0);
    });

    it('counts a checked-out client as active', async () => {
        const client = await pool.connect();
        try {
            expect(poolState(pool).active).toBeGreaterThanOrEqual(1);
        } finally {
            client.release();
        }
    });
});
