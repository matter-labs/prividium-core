import { addMinutes } from 'date-fns';
import { vi } from 'vitest';

export function minutesInTheFuture(minutes: number): Date {
    return addMinutes(new Date(), minutes);
}

export function mockSessionResponse(token: string, expiration: Date, absoluteExpiration?: Date) {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
            JSON.stringify({
                token: token,
                expiresAt: expiration.toISOString(),
                ...(absoluteExpiration !== undefined && { renewableUntil: absoluteExpiration.toISOString() })
            })
        )
    );
}
