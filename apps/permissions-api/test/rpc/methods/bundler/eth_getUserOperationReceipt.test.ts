import { getAddress, pad } from 'viem';
import { describe, expect } from 'vitest';
import { ZERO_LOGS_BLOOM } from '../../../../src/rpc/constants';
import { eth_getUserOperationReceipt } from '../../../../src/rpc/methods/handlers/bundler/eth_getUserOperationReceipt';
import { it } from '../../test-bundler-env';

describe('eth_getUserOperationReceipt', () => {
    const method = eth_getUserOperationReceipt;
    const userOpHash = '0x4294364950d5b9c9045e4d4ad103ac496b3138d0edca78980b52ee2bbb6ae9bb';
    const reqId = 'req-1';

    const NON_ZERO_BLOOM =
        '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000004000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000010080000800000000000000000';

    function createUserOpReceipt(sender: string) {
        return {
            sender: getAddress(sender),
            nonce: '0x1',
            actualGasCost: '0x100',
            actualGasUsed: '0x50',
            success: true,
            logsBloom: NON_ZERO_BLOOM,
            logs: [],
            receipt: {
                transactionHash: '0x1234',
                logsBloom: NON_ZERO_BLOOM
            }
        };
    }

    it('zeroes logsBloom in receipt when user is associated', async ({ reqContext, bundlerRpc, authorizer }) => {
        const userAddress = getAddress('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
        authorizer.setUserAddresses([userAddress]);

        const receipt = createUserOpReceipt(userAddress);
        bundlerRpc.registerSend(reqId, receipt);

        const res = await method.handle(reqContext, 'eth_getUserOperationReceipt', [userOpHash], reqId);

        expect(res).toMatchObject({
            id: reqId,
            result: {
                sender: userAddress,
                logsBloom: ZERO_LOGS_BLOOM
            }
        });
    });

    it('returns null when user is not associated with sender', async ({ reqContext, bundlerRpc, authorizer }) => {
        const userAddress = getAddress('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
        const otherAddress = getAddress(pad('0x01', { size: 20 }));
        authorizer.setUserAddresses([userAddress]);

        const receipt = createUserOpReceipt(otherAddress);
        bundlerRpc.registerSend(reqId, receipt);

        const res = await method.handle(reqContext, 'eth_getUserOperationReceipt', [userOpHash], reqId);

        expect(res).toMatchObject({
            id: reqId,
            result: null
        });
    });

    it('returns null when receipt does not exist', async ({ reqContext, bundlerRpc, authorizer }) => {
        const userAddress = getAddress('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
        authorizer.setUserAddresses([userAddress]);

        bundlerRpc.registerSend(reqId, null);

        const res = await method.handle(reqContext, 'eth_getUserOperationReceipt', [userOpHash], reqId);

        expect(res).toMatchObject({
            id: reqId,
            result: null
        });
    });
});
