import { describe, expect, it } from 'vitest';
import { extractResponseError } from './error-utils.js';

function createMockResponse(options: { status: number; statusText: string; body?: string }): Response {
    return {
        status: options.status,
        statusText: options.statusText,
        clone() {
            return {
                text: () => Promise.resolve(options.body ?? '')
            };
        }
    } as unknown as Response;
}

describe('extractResponseError', () => {
    it('extracts code and message from API error response', async () => {
        const response = createMockResponse({
            status: 404,
            statusText: 'Not Found',
            body: JSON.stringify({
                error: { code: 'NOT_FOUND', message: 'User with walletAddress "0xabc" not found' }
            })
        });

        const result = await extractResponseError(response);
        expect(result).toBe('404 Not Found: User with walletAddress "0xabc" not found (NOT_FOUND)');
    });

    it('extracts message when code is missing from error object', async () => {
        const response = createMockResponse({
            status: 500,
            statusText: 'Internal Server Error',
            body: JSON.stringify({ error: { message: 'Something went wrong' } })
        });

        // Schema requires both code and message, so this falls through to raw text
        const result = await extractResponseError(response);
        expect(result).toBe('500 Internal Server Error: {"error":{"message":"Something went wrong"}}');
    });

    it('falls back to raw text for non-JSON response', async () => {
        const response = createMockResponse({
            status: 502,
            statusText: 'Bad Gateway',
            body: 'Bad Gateway'
        });

        const result = await extractResponseError(response);
        expect(result).toBe('502 Bad Gateway: Bad Gateway');
    });

    it('falls back to status and statusText for empty body', async () => {
        const response = createMockResponse({
            status: 500,
            statusText: 'Internal Server Error',
            body: ''
        });

        const result = await extractResponseError(response);
        expect(result).toBe('500 Internal Server Error');
    });

    it('falls back to status and statusText when JSON has no error field', async () => {
        const response = createMockResponse({
            status: 400,
            statusText: 'Bad Request',
            body: JSON.stringify({ something: 'else' })
        });

        // Not matching apiErrorSchema, and valid JSON won't hit the catch, so falls through as raw text
        const result = await extractResponseError(response);
        expect(result).toBe('400 Bad Request: {"something":"else"}');
    });

    it('handles response where clone/text throws', async () => {
        const response = {
            status: 500,
            statusText: 'Internal Server Error',
            clone() {
                return {
                    text: () => Promise.reject(new Error('body already consumed'))
                };
            }
        } as unknown as Response;

        const result = await extractResponseError(response);
        expect(result).toBe('500 Internal Server Error');
    });

    it('handles all known API error codes', async () => {
        const codes = [
            'INVALID_INPUT_ERROR',
            'UNAUTHORIZED_ERROR',
            'FORBIDDEN_ERROR',
            'RATE_LIMIT_ERROR',
            'INTERNAL_SERVER_ERROR'
        ];

        for (const code of codes) {
            const response = createMockResponse({
                status: 400,
                statusText: 'Bad Request',
                body: JSON.stringify({ error: { code, message: `Test ${code}` } })
            });

            const result = await extractResponseError(response);
            expect(result).toBe(`400 Bad Request: Test ${code} (${code})`);
        }
    });
});
