import { custom, getContract, type PublicClient } from 'viem';
import { describe, expect, it } from 'vitest';
import { createPrividiumClient } from './create-prividium-client';

describe('createPrividiumClient', () => {
    it('returns a public client', () => {
        const client = createPrividiumClient({
            transport: custom({
                request: vi.fn()
            }),
            chain: {
                id: 9_999,
                name: 'test',
                nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
                rpcUrls: { default: { http: ['http://localhost:8545'] } }
            },
            account: undefined
        });

        expect(client).toBeDefined();

        // Exposes public client methods (not exhaustive)
        expect(typeof client.call).toBe('function');
        expect(typeof client.getBlockNumber).toBe('function');
        expect(typeof client.getChainId).toBe('function');
    });

    it('throws an error if no wallet address is provided for client.call', () => {
        const client = createPrividiumClient({
            transport: custom({
                request: vi.fn()
            }),
            chain: {
                id: 9_999,
                name: 'test',
                nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
                rpcUrls: { default: { http: ['http://localhost:8545'] } }
            },
            account: undefined
        });

        expect(() => client.call({ to: '0x1234567890abcdef1234567890abcdef12345678' })).toThrow(
            'RPC method eth_call requires an account to be provided for the client'
        );
    });

    it('passes the user wallet address if provided for client.call', () => {
        const client = createPrividiumClient({
            transport: custom({
                request: vi.fn()
            }),
            chain: {
                id: 9_999,
                name: 'test',
                nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
                rpcUrls: { default: { http: ['http://localhost:8545'] } }
            },
            account: '0x000000000000000000000000000000000000000A'
        });

        expect(() =>
            client.call({
                to: '0x000000000000000000000000000000000000dEaD',
                account: '0x000000000000000000000000000000000000000A'
            })
        ).not.toThrow();
    });

    it('calls client.call with `from` field set to user wallet for a view function', async () => {
        const mockCall = vi.fn();
        const client = createPrividiumClient({
            transport: custom({
                request: mockCall.mockResolvedValue(
                    '0x000000000000000000000000000000000000000000000000000000000000002a'
                )
            }),
            chain: {
                id: 9_999,
                name: 'test',
                nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
                rpcUrls: { default: { http: ['http://localhost:8545'] } }
            },
            account: '0x000000000000000000000000000000000000000A'
        });

        const abi = [
            {
                type: 'function',
                name: 'getBid',
                inputs: [],
                outputs: [
                    {
                        name: '',
                        type: 'uint256',
                        internalType: 'uint256'
                    }
                ],
                stateMutability: 'view'
            }
        ];

        const contract = getContract({
            address: '0x000000000000000000000000000000000000dEaD',
            abi: abi,
            client: client as unknown as PublicClient
        });

        await contract.read.getBid();

        expect(mockCall).toHaveBeenCalled();
        expect(mockCall.mock.calls[0]?.[0]).toEqual(
            expect.objectContaining({
                method: 'eth_call',
                params: [
                    {
                        data: '0x099a019d',
                        to: '0x000000000000000000000000000000000000dEaD',
                        from: '0x000000000000000000000000000000000000000A'
                    },
                    'latest'
                ]
            })
        );
    });
});
