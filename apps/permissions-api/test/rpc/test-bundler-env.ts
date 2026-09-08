import { it as baseIt } from '@vitest/runner';
import type { BundlerContext } from '../../src/rpc/methods/handlers/bundler/utils/is-bundler-context';
import type { BundlerRpcContext } from '../../src/rpc/rpc-service';
import { TestExternalRpc } from './test-external-rpc';
import { createDispatcherConfig, createMockRpcClient } from './test-mocks';
import { TestRpcAuthorizer } from './test-rpc-authorizer';

export type BundlerFixture = {
    rpc: TestExternalRpc;
    bundlerRpc: TestExternalRpc;
    reqContext: BundlerContext;
    authorizer: TestRpcAuthorizer;
};

export const it = baseIt.extend<BundlerFixture>({
    // biome-ignore lint/correctness/noEmptyPattern: vitest fixture
    rpc: async ({}, use) => {
        const rpc = new TestExternalRpc();
        await use(rpc);
    },
    // biome-ignore lint/correctness/noEmptyPattern: vitest fixture
    bundlerRpc: async ({}, use) => {
        const bundlerRpc = new TestExternalRpc();
        await use(bundlerRpc);
    },
    authorizer: new TestRpcAuthorizer(),
    reqContext: async ({ rpc, bundlerRpc, authorizer }, use) => {
        const context: BundlerRpcContext = {
            targetRpc: rpc,
            bundlerRpc,
            authorizer,
            rpcClient: createMockRpcClient(),
            dispatcherConfig: createDispatcherConfig()
        } as unknown as BundlerRpcContext;
        await use(context);
    }
});
