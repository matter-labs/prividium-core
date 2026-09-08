import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type FakeRpcServer, type RpcHandler, startFakeRpc } from './fake-rpc-server.js';
import {
    ACCOUNT_DATA_DISCLOSURE,
    CALL_DISCLOSURE,
    CONTRACT_ADDRESS,
    DIAMOND_ADDRESS,
    EXPECTED_L1_BATCH_HASH
} from './verify-fixtures.js';

type ConfigOverrides = {
    apiUrl?: string;
    l1RpcUrl?: string;
    localZksyncOsRpcUrl?: string;
    diamondAddress?: string;
    userPanelUrl?: string;
};

export class CliStack {
    constructor(
        public readonly prividium: FakeRpcServer,
        public readonly l1: FakeRpcServer,
        public readonly l2: FakeRpcServer,
        public readonly configPath: string,
        private readonly tempDir: string
    ) {}

    async close(): Promise<void> {
        await Promise.all([this.prividium.close(), this.l1.close(), this.l2.close()]);
        await rm(this.tempDir, { recursive: true, force: true });
    }
}

export class CliStackBuilder {
    private prividiumHandlers: Record<string, RpcHandler> = {
        prividium_tokenSupplyDisclosure: () => CALL_DISCLOSURE,
        prividium_tokenBalanceDisclosure: () => CALL_DISCLOSURE,
        prividium_accountDataDisclosure: () => ACCOUNT_DATA_DISCLOSURE
    };
    private l1Handlers: Record<string, RpcHandler> = {
        eth_chainId: () => '0x1',
        eth_call: () => EXPECTED_L1_BATCH_HASH
    };
    private l2Handlers: Record<string, RpcHandler> = {
        eth_chainId: () => '0x1',
        eth_call: () => CALL_DISCLOSURE.result,
        debug_traceCall: () => ({
            success: true,
            reads: { [CONTRACT_ADDRESS]: ['3'] },
            value: CALL_DISCLOSURE.result
        })
    };
    private configOverrides: ConfigOverrides = {};

    withPrividiumMethod(method: string, handler: RpcHandler): this {
        this.prividiumHandlers[method] = handler;
        return this;
    }

    withL1Method(method: string, handler: RpcHandler): this {
        this.l1Handlers[method] = handler;
        return this;
    }

    withL2Method(method: string, handler: RpcHandler): this {
        this.l2Handlers[method] = handler;
        return this;
    }

    withConfig(overrides: ConfigOverrides): this {
        Object.assign(this.configOverrides, overrides);
        return this;
    }

    async build(): Promise<CliStack> {
        const [prividium, l1, l2] = await Promise.all([
            startFakeRpc(this.prividiumHandlers),
            startFakeRpc(this.l1Handlers),
            startFakeRpc(this.l2Handlers)
        ]);

        const tempDir = await mkdtemp(path.join(tmpdir(), 'prividium-cli-test-'));
        const configPath = path.join(tempDir, 'config.json');
        await writeFile(
            configPath,
            JSON.stringify({
                latest: {
                    apiUrl: prividium.url,
                    l1RpcUrl: l1.url,
                    localZksyncOsRpcUrl: l2.url,
                    diamondAddress: DIAMOND_ADDRESS,
                    ...this.configOverrides
                } satisfies ConfigOverrides
            })
        );

        return new CliStack(prividium, l1, l2, configPath, tempDir);
    }
}
