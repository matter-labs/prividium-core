import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPrividiumSiweChain, type PrividiumSiweConfig } from '../siwe-chain.js';

const TEST_PRIVATE_KEY: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_API_URL = 'https://api.example.com';
const TEST_DOMAIN = 'localhost:3000';
const TEST_SIWE_MSG = 'Sign in to Prividium';
const TEST_NONCE_TOKEN = 'test-nonce-token';
const TEST_TOKEN = 'session-token-abc';
const TEST_EXPIRES_AT = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

const TEST_CHAIN = { id: 270, name: 'Prividium' } as PrividiumSiweConfig['chain'];

const sampleContract = {
    contractAddress: '0xabc',
    abi: '[]',
    name: null,
    description: null,
    discloseErc20TotalSupply: false,
    discloseBytecode: false,
    templateId: 5,
    isSystemContract: false,
    organizationId: null,
    disclosedAddresses: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    disclosureStartBlock: '0x0'
};

function defaultConfig(overrides?: Partial<PrividiumSiweConfig>): PrividiumSiweConfig {
    return {
        chain: TEST_CHAIN,
        prividiumApiBaseUrl: TEST_API_URL,
        account: privateKeyToAccount(TEST_PRIVATE_KEY),
        domain: TEST_DOMAIN,
        ...overrides
    };
}

function mockApiFetch(responder: (url: string, init?: RequestInit) => unknown | Promise<unknown>) {
    return vi.fn().mockImplementation(async (url: string | URL, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/siwe-messages')) {
            return {
                ok: true,
                status: 200,
                statusText: 'OK',
                json: async () => ({ msg: TEST_SIWE_MSG, nonceToken: TEST_NONCE_TOKEN })
            };
        }
        if (urlStr.includes('/api/auth/login/crypto-native')) {
            return {
                ok: true,
                status: 200,
                statusText: 'OK',
                json: async () => ({ token: TEST_TOKEN, expiresAt: TEST_EXPIRES_AT })
            };
        }
        const result = await responder(urlStr, init);
        return result;
    });
}

describe('chain.admin.contracts.create', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('sends a POST to /api/contracts with the create body and parses the response', async () => {
        const seenInits: RequestInit[] = [];
        const fetchMock = mockApiFetch((url, init) => {
            if (url.endsWith('/api/contracts')) {
                if (init) seenInits.push(init);
                return { ok: true, status: 201, statusText: 'Created', json: async () => sampleContract };
            }
            return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) };
        });
        Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true });

        const sdk = createPrividiumSiweChain(defaultConfig());
        await sdk.authorize();

        const params = {
            contractAddress: '0xabc',
            templateKey: 'erc20',
            abi: '[]',
            name: null,
            description: null,
            discloseErc20TotalSupply: false,
            discloseBytecode: false,
            disclosureStartBlock: '0x0'
        };
        const contract = await sdk.admin.contracts.create(params);

        expect(contract.contractAddress).toBe('0xabc');
        expect(contract.templateId).toBe(5);

        const lastInit = seenInits.at(-1);
        expect(lastInit?.method).toBe('POST');
        expect(JSON.parse((lastInit?.body as string) ?? '{}')).toEqual(params);
        expect(new Headers(lastInit?.headers).get('Authorization')).toBe(`Bearer ${TEST_TOKEN}`);
    });

    it('throws on 403 forbidden', async () => {
        const fetchMock = mockApiFetch((url) => {
            if (url.endsWith('/api/contracts')) {
                return { ok: false, status: 403, statusText: 'Forbidden', text: async () => 'forbidden' };
            }
            return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) };
        });
        Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true });

        const sdk = createPrividiumSiweChain(defaultConfig());
        await sdk.authorize();

        await expect(
            sdk.admin.contracts.create({
                contractAddress: '0xabc',
                abi: '[]',
                name: null,
                description: null,
                disclosureStartBlock: '0x0'
            })
        ).rejects.toThrow(/Error calling/);
    });
});
