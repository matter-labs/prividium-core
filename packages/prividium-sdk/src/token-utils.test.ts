import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateRandomState } from './token-utils.js';

// Mock global functions needed for JWT parsing
Object.defineProperty(globalThis, 'atob', {
    value: (str: string) => Buffer.from(str, 'base64').toString('binary'),
    writable: true
});

Object.defineProperty(globalThis, 'btoa', {
    value: (str: string) => Buffer.from(str, 'binary').toString('base64'),
    writable: true
});

// Mock crypto
Object.defineProperty(globalThis, 'crypto', {
    value: {
        getRandomValues: vi.fn((array: unknown[]) => {
            for (let i = 0; i < array.length; i++) {
                array[i] = Math.floor(Math.random() * 256);
            }
            return array;
        })
    },
    writable: true
});

describe('token-utils', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('generateRandomState', () => {
        it('should generate a random hex string', () => {
            const state1 = generateRandomState();
            const state2 = generateRandomState();

            expect(state1).toMatch(/^[a-f0-9]+$/);
            expect(state2).toMatch(/^[a-f0-9]+$/);
            expect(state1).not.toBe(state2);
            expect(state1.length).toBe(64); // 32 bytes * 2 hex chars
        });
    });
});
