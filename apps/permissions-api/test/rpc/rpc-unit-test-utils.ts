import { it as baseIt } from '@vitest/runner';
import pino from 'pino';
import type { CreateContractDeployment } from '../../src/repositories/contract-deployments-repository';
import type { DeployOutcome } from '../../src/rpc/contract-deployment-context';
import type { BundlerContext } from '../../src/rpc/methods/handlers/bundler/utils/is-bundler-context';
import type { AuthorizedRpcContext } from '../../src/rpc/rpc-service';
import { TestExternalRpc } from './test-external-rpc';
import { createDispatcherConfig } from './test-mocks';
import { TestRpcAuthorizer } from './test-rpc-authorizer';

export type Fixture = {
    rpc: TestExternalRpc;
    reqContext: AuthorizedRpcContext;
    authorizer: TestRpcAuthorizer;
};

export type BundlerFixture = {
    rpc: TestExternalRpc;
    reqContext: BundlerContext;
    authorizer: TestRpcAuthorizer;
};

export const rpcUnitTest = baseIt.extend<Fixture>({
    // biome-ignore lint/correctness/noEmptyPattern: vitest fixture
    rpc: async ({}, use) => {
        const rpc = new TestExternalRpc();
        await use(rpc);
    },
    // biome-ignore lint/correctness/noEmptyPattern: vitest fixture
    authorizer: async ({}, use) => {
        use(new TestRpcAuthorizer());
    },
    reqContext: async ({ rpc, authorizer }, use) => {
        const context: AuthorizedRpcContext = {
            targetRpc: rpc,
            authorizer
        } as unknown as AuthorizedRpcContext;
        await use(context);
    }
});

export const bundlerUnitTest = baseIt.extend<BundlerFixture>({
    // biome-ignore lint/correctness/noEmptyPattern: vitest fixture
    rpc: async ({}, use) => {
        const rpc = new TestExternalRpc();
        await use(rpc);
    },
    authorizer: new TestRpcAuthorizer(),
    reqContext: async ({ rpc, authorizer }, use) => {
        const context: BundlerContext = {
            targetRpc: rpc,
            authorizer,
            dispatcherConfig: createDispatcherConfig(),
            bundlerRpc: rpc,
            logger: pino({ level: 'silent' }),
            policyEnabled: false,
            deployment: {
                async recordedDeploy<T>(
                    _data: CreateContractDeployment,
                    _deployerUserId: string,
                    fn: () => Promise<DeployOutcome<T>>
                ): Promise<T> {
                    return fn().then(({ result }) => result);
                }
            }
        };
        await use(context);
    }
});
