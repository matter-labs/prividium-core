import { describe, expect, it, vi } from 'vitest';
import { createDb } from './index';

const logger = { error: () => {} };

describe('createDb with a resolved connection', () => {
    it("hands the pool the provider's config and the lifetime, and closes the connection after the pool ends", async () => {
        const order: string[] = [];
        const close = vi.fn(async () => {
            order.push('close');
        });
        const db = createDb(
            { poolConfig: { host: 'from-provider' }, close },
            logger,
            false,
            true,
            10_000,
            10_000,
            10,
            5_000,
            undefined,
            1800
        );
        expect(db.$client.options).toMatchObject({ host: 'from-provider', maxLifetimeSeconds: 1800 });

        const end = db.$client.end.bind(db.$client);
        vi.spyOn(db.$client, 'end').mockImplementation((async () => {
            await end();
            order.push('end');
        }) as typeof db.$client.end);
        await db.close();

        expect(close).toHaveBeenCalledTimes(1);
        expect(order).toEqual(['end', 'close']);
    });
});
