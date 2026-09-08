import { pino } from 'pino';
import { describe, expect, test } from 'vitest';
import type { CreateContractDeployment } from '../../../../src/repositories/contract-deployments-repository';
import type { DeploymentContext, DeployOutcome } from '../../../../src/rpc/contract-deployment-context';
import { handleContractDeployment } from '../../../../src/rpc/methods/generic-handlers/deploy-utils';
import type { BaseContext } from '../../../../src/rpc/rpc-service';
import type { TxData } from '../../../../src/rpc/types';
import { TestExternalRpc } from '../../test-external-rpc';

const DEPLOYER = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const RAW_TX = '0xdeadbeef';
const TX: TxData = { from: DEPLOYER, data: '0x60016002', to: undefined, nonce: 0, value: 0n };
const HASH = '0x1111111111111111111111111111111111111111111111111111111111111111';

class RecordingDeploymentContext implements DeploymentContext {
    confirmed: boolean | undefined;
    errored: string | undefined;

    async recordedDeploy<T>(
        _data: CreateContractDeployment,
        _deployerUserId: string,
        fn: () => Promise<DeployOutcome<T>>
    ): Promise<T> {
        try {
            const { result, confirmed } = await fn();
            this.confirmed = confirmed;
            return result;
        } catch (e) {
            this.errored = (e as Error).message;
            throw e;
        }
    }
}

function deployContext(chainType: 'zksync-os' | 'besu') {
    const targetRpc = new TestExternalRpc();
    targetRpc.chainType = chainType;
    const deployment = new RecordingDeploymentContext();
    const context: BaseContext = {
        targetRpc,
        bundlerRpc: null,
        logger: pino({ level: 'silent' }),
        deployment
    };
    return { context, targetRpc, deployment };
}

describe('handleContractDeployment resolution', () => {
    test('zksync-os sync receipt confirms the deployment', async () => {
        const { context, targetRpc, deployment } = deployContext('zksync-os');
        targetRpc.registerDelegate('req-1', { jsonrpc: '2.0', id: 'req-1', result: { transactionHash: HASH } });

        const result = await handleContractDeployment(TX, context, 'req-1', RAW_TX, 'user-1');

        expect(result).toEqual({ jsonrpc: '2.0', id: 'req-1', result: HASH });
        expect(deployment.confirmed).toBe(true);
    });

    test('zksync-os EIP-7966 timeout leaves the deployment unconfirmed', async () => {
        const { context, targetRpc, deployment } = deployContext('zksync-os');
        targetRpc.registerDelegate('req-1', {
            jsonrpc: '2.0',
            id: 'req-1',
            error: { code: 4, message: 'transaction not mined within timeout' }
        });

        const result = await handleContractDeployment(TX, context, 'req-1', RAW_TX, 'user-1');

        expect(result).toMatchObject({ error: { code: 4 } });
        expect(deployment.confirmed).toBe(false);
    });

    test('besu accepted hash leaves the deployment unconfirmed', async () => {
        const { context, targetRpc, deployment } = deployContext('besu');
        targetRpc.registerDelegate('req-1', { jsonrpc: '2.0', id: 'req-1', result: HASH });

        const result = await handleContractDeployment(TX, context, 'req-1', RAW_TX, 'user-1');

        expect(result).toEqual({ jsonrpc: '2.0', id: 'req-1', result: HASH });
        expect(deployment.confirmed).toBe(false);
    });

    test('submission errors mark the deployment errored', async () => {
        const { context, targetRpc, deployment } = deployContext('besu');
        targetRpc.registerDelegate('req-1', {
            jsonrpc: '2.0',
            id: 'req-1',
            error: { code: -32000, message: 'nonce too low' }
        });

        await expect(handleContractDeployment(TX, context, 'req-1', RAW_TX, 'user-1')).rejects.toThrow('nonce too low');
        expect(deployment.errored).toBe('nonce too low');
    });
});
