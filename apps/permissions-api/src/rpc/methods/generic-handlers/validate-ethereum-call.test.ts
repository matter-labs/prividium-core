import { type Address, getAddress, toFunctionSelector } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import { rpcUnitTest } from '../../../../test/rpc/rpc-unit-test-utils';
import { createDispatcherConfig, MOCK_BYTECODE } from '../../../../test/rpc/test-mocks';
import { ForbiddenRpcError } from '../../errors';
import { response } from '../../json-rpc';
import type { AuthorizedRpcContext } from '../../rpc-service';
import { validatedEthereumCall } from './validate-ethereum-call';

const CALL_OBJECT = {
    from: '0x36615cf349d7f6344891b1e7ca7c72883f5dc049',
    to: '0x000000000000000000000000000000000000800a',
    data: '0x70a0823100000000000000000000000036615cf349d7f6344891b1e7ca7c72883f5dc049'
};

const OWN_WALLET: Address = '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc';
const FOREIGN_WALLET: Address = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
// Checksummed: the params schema checksums `to`, and the stub's code map is keyed by exact string.
const RECIPIENT: Address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const VALUE_TRANSFER = { to: RECIPIENT, value: '0xde0b6b3a7640000' };
const EIP712_DOMAIN_CALL = { to: getAddress(CALL_OBJECT.to), data: toFunctionSelector('eip712Domain()') };
const REQUEST_ID = 1;
const UPSTREAM_RESPONSE = response({ id: REQUEST_ID, result: '0x5208' });

describe('validatedEthereumCall params schema', () => {
    const { paramsSchema } = validatedEthereumCall('eth_call', 2);

    // zod ≥4.4 makes a bare z.unknown() object key required; standard clients
    // (viem, ethers, cast) never send chainId, so it must stay optional.
    it('accepts a call object without chainId', () => {
        expect(paramsSchema.safeParse([CALL_OBJECT, 'latest']).success).toBe(true);
    });

    it('accepts and ignores a provided chainId', () => {
        expect(paramsSchema.safeParse([{ ...CALL_OBJECT, chainId: '0x129' }, 'latest']).success).toBe(true);
    });

    it('rejects unknown keys', () => {
        expect(paramsSchema.safeParse([{ ...CALL_OBJECT, bogus: 1 }, 'latest']).success).toBe(false);
    });
});

describe.each([
    validatedEthereumCall('eth_call', 2, 'read'),
    validatedEthereumCall('eth_estimateGas', 2, 'write')
])('validatedEthereumCall $name from ownership', (handler) => {
    const simulate = (reqContext: AuthorizedRpcContext, call: object, block: unknown = 'latest') =>
        handler.handle(reqContext, handler.name, handler.paramsSchema.parse([call, block]), REQUEST_ID);

    rpcUnitTest('refuses empty calldata from a wallet the caller does not own', async ({ reqContext, authorizer }) => {
        authorizer.setUserAddresses([OWN_WALLET]);

        const denial = simulate(reqContext, { ...VALUE_TRANSFER, from: FOREIGN_WALLET });

        await expect(denial).rejects.toThrow(ForbiddenRpcError);
        await expect(denial).rejects.toHaveProperty('ruleId', 'wallet.not_owned_by_user');
    });

    // The selector alone does not prove an ERC-5267 implementation: a fallback-only contract would run.
    rpcUnitTest('authorizes eip712Domain() like any other contract call', async ({ reqContext, authorizer, rpc }) => {
        authorizer.setUserAddresses([OWN_WALLET]);
        authorizer.setAllowRead(false);

        const denial = simulate(reqContext, { ...EIP712_DOMAIN_CALL, from: OWN_WALLET });

        await expect(denial).rejects.toThrow(ForbiddenRpcError);
        await expect(denial).rejects.toHaveProperty('ruleId', 'permission.missing');
        expect(rpc.delegateRegistry).toEqual([]);
    });

    rpcUnitTest('forwards empty calldata from a wallet the caller owns', async ({ reqContext, authorizer, rpc }) => {
        authorizer.setUserAddresses([OWN_WALLET]);
        rpc.registerDelegate(`${REQUEST_ID}`, UPSTREAM_RESPONSE);

        await expect(simulate(reqContext, { ...VALUE_TRANSFER, from: OWN_WALLET })).resolves.toEqual(UPSTREAM_RESPONSE);
    });

    rpcUnitTest('forwards empty calldata with no from', async ({ reqContext, rpc }) => {
        rpc.registerDelegate(`${REQUEST_ID}`, UPSTREAM_RESPONSE);

        await expect(simulate(reqContext, VALUE_TRANSFER)).resolves.toEqual(UPSTREAM_RESPONSE);
    });

    rpcUnitTest(
        'checks the receive permission for empty calldata to a contract',
        async ({ reqContext, authorizer, rpc }) => {
            authorizer.setUserAddresses([OWN_WALLET]);
            authorizer.setAllowRead(false);
            rpc.registerCodeFor(RECIPIENT, MOCK_BYTECODE);

            const denial = simulate(reqContext, { ...VALUE_TRANSFER, from: OWN_WALLET });

            await expect(denial).rejects.toThrow(ForbiddenRpcError);
            await expect(denial).rejects.toHaveProperty('ruleId', 'permission.missing');
            expect(rpc.delegateRegistry).toEqual([]);
        }
    );

    rpcUnitTest(
        'forwards empty calldata to a contract with the receive permission',
        async ({ reqContext, authorizer, rpc }) => {
            authorizer.setUserAddresses([OWN_WALLET]);
            rpc.registerCodeFor(RECIPIENT, MOCK_BYTECODE);
            rpc.registerDelegate(`${REQUEST_ID}`, UPSTREAM_RESPONSE);

            await expect(simulate(reqContext, { ...VALUE_TRANSFER, from: OWN_WALLET })).resolves.toEqual(
                UPSTREAM_RESPONSE
            );
        }
    );

    rpcUnitTest(
        'pins the code check and the forwarded call to the head block',
        async ({ reqContext, authorizer, rpc }) => {
            authorizer.setUserAddresses([OWN_WALLET]);
            rpc.headBlock = '0x2a';
            rpc.registerDelegate(`${REQUEST_ID}`, UPSTREAM_RESPONSE);

            await expect(simulate(reqContext, { ...VALUE_TRANSFER, from: OWN_WALLET })).resolves.toEqual(
                UPSTREAM_RESPONSE
            );

            expect(rpc.codeQueries).toEqual([{ address: RECIPIENT, block: '0x2a' }]);
            expect(rpc.delegateRegistry.map((entry) => entry.params)).toEqual([[expect.anything(), '0x2a']]);
        }
    );

    rpcUnitTest('checks code at the block the caller names', async ({ reqContext, authorizer, rpc }) => {
        authorizer.setUserAddresses([OWN_WALLET]);
        rpc.registerDelegate(`${REQUEST_ID}`, UPSTREAM_RESPONSE);

        await expect(simulate(reqContext, { ...VALUE_TRANSFER, from: OWN_WALLET }, '0x5')).resolves.toEqual(
            UPSTREAM_RESPONSE
        );

        expect(rpc.codeQueries).toEqual([{ address: RECIPIENT, block: '0x5' }]);
        expect(rpc.delegateRegistry.map((entry) => entry.params)).toEqual([[expect.anything(), '0x5']]);
    });

    rpcUnitTest(
        'requires permission for empty calldata with a block-hash object',
        async ({ reqContext, authorizer, rpc }) => {
            authorizer.setUserAddresses([OWN_WALLET]);
            authorizer.setAllowRead(false);

            await expect(
                simulate(
                    reqContext,
                    { ...VALUE_TRANSFER, from: OWN_WALLET },
                    {
                        blockHash: `0x${'ab'.repeat(32)}`
                    }
                )
            ).rejects.toHaveProperty('ruleId', 'permission.missing');
            expect(rpc.codeQueries).toEqual([]);
            expect(rpc.delegateRegistry).toEqual([]);
        }
    );

    // A pending deployment has no code at any mined block, so `pending` cannot be classified safely.
    rpcUnitTest(
        'runs the permission check for empty calldata at the pending block',
        async ({ reqContext, authorizer, rpc }) => {
            authorizer.setUserAddresses([OWN_WALLET]);
            authorizer.setAllowRead(false);

            const denial = simulate(reqContext, { ...VALUE_TRANSFER, from: OWN_WALLET }, 'pending');

            await expect(denial).rejects.toThrow(ForbiddenRpcError);
            await expect(denial).rejects.toHaveProperty('ruleId', 'permission.missing');
            expect(rpc.codeQueries).toEqual([]);
            expect(rpc.delegateRegistry).toEqual([]);
        }
    );
});

rpcUnitTest(
    'requires a domain permission even for an allowlisted SSO proxy',
    async ({ reqContext, authorizer, rpc }) => {
        const handler = validatedEthereumCall('eth_call', 2, 'read');
        authorizer.setAllowRead(false);
        reqContext.dispatcherConfig = createDispatcherConfig();
        rpc.registerCodeFor(EIP712_DOMAIN_CALL.to, MOCK_BYTECODE);
        const resolveBlock = vi.spyOn(rpc, 'resolveBlock');

        await expect(
            handler.handle(
                reqContext,
                handler.name,
                handler.paramsSchema.parse([EIP712_DOMAIN_CALL, 'latest']),
                REQUEST_ID
            )
        ).rejects.toThrow(ForbiddenRpcError);
        expect(resolveBlock).not.toHaveBeenCalled();
        expect(rpc.codeQueries).toEqual([]);
        expect(rpc.delegateRegistry).toEqual([]);
    }
);
