import { type Address, toFunctionSelector } from 'viem';
import { describe, expect, it } from 'vitest';
import { rpcUnitTest } from '../../../../test/rpc/rpc-unit-test-utils';
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
const VALUE_TRANSFER = { to: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266', value: '0xde0b6b3a7640000' };
const EIP712_DOMAIN_CALL = { to: CALL_OBJECT.to, data: toFunctionSelector('eip712Domain()') };
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
    const simulate = (reqContext: AuthorizedRpcContext, call: object) =>
        handler.handle(reqContext, handler.name, handler.paramsSchema.parse([call, 'latest']), REQUEST_ID);

    rpcUnitTest('refuses empty calldata from a wallet the caller does not own', async ({ reqContext, authorizer }) => {
        authorizer.setUserAddresses([OWN_WALLET]);

        const denial = simulate(reqContext, { ...VALUE_TRANSFER, from: FOREIGN_WALLET });

        await expect(denial).rejects.toThrow(ForbiddenRpcError);
        await expect(denial).rejects.toHaveProperty('ruleId', 'wallet.not_owned_by_user');
    });

    rpcUnitTest('refuses eip712Domain() from a wallet the caller does not own', async ({ reqContext, authorizer }) => {
        authorizer.setUserAddresses([OWN_WALLET]);

        const denial = simulate(reqContext, { ...EIP712_DOMAIN_CALL, from: FOREIGN_WALLET });

        await expect(denial).rejects.toThrow(ForbiddenRpcError);
        await expect(denial).rejects.toHaveProperty('ruleId', 'wallet.not_owned_by_user');
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
});
