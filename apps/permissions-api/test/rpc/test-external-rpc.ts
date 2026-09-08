import { type Address, type BlockTag, type Hex, type PublicClient, size } from 'viem';
import type { TypeOf, ZodTypeAny } from 'zod/v4';
import type { JSONLike, JsonRpcRequest, JsonRpcResponse } from '../../src/rpc/json-rpc';
import { type ExternalRpc, submitRawTransactionUpstream, type ZksGetProofResponse } from '../../src/rpc/target-rpc';
import type { TargetChainType } from '../../src/utils/target-chain';
import { createMockRpcClient } from './test-mocks';

type HistoryEntry = {
    id: string;
    params: unknown[];
    method: string;
};

type DebugCallEntry = {
    id: string | number;
    from: Address;
    to: Address;
    callData: Hex;
    blockNumber: BlockTag;
};

type BatchForBlockEntry = {
    id: string;
    block: BlockTag | Hex;
    blockNumber: Hex;
};

type GetProfEntry = {
    id: string;
    address: Hex;
    slotList: Hex[];
    batchNumber: number;
};

export class TestExternalRpc implements ExternalRpc {
    chainType: TargetChainType = 'zksync-os';
    delegateResponses: Map<string, JsonRpcResponse>;
    delegateRegistry: HistoryEntry[];
    sendResponses: Map<string, JSONLike>;
    sendErrors: Map<string, Error>;
    sendRegistry: HistoryEntry[];
    codes: Map<Address, Hex>;
    nonces: Map<Address, bigint>;
    balances: Map<Address, Hex>;

    debugCallResponses: Map<string, JSONLike>;
    debugCallRegistry: DebugCallEntry[];
    batchForBlockResponses: Map<string, number>;
    batchForBlockErrors: Map<string, Error>;
    batchForBlockRegistry: BatchForBlockEntry[];
    getProfResponses: Map<string, ZksGetProofResponse>;
    getProfRegistry: GetProfEntry[];
    resolveBlockResponses: Map<string, Hex>;

    constructor() {
        this.delegateResponses = new Map();
        this.sendResponses = new Map();
        this.sendErrors = new Map();
        this.delegateRegistry = [];
        this.sendRegistry = [];
        this.codes = new Map();
        this.nonces = new Map();
        this.balances = new Map();
        this.debugCallResponses = new Map();
        this.debugCallRegistry = [];
        this.batchForBlockResponses = new Map();
        this.batchForBlockErrors = new Map();
        this.batchForBlockRegistry = [];
        this.getProfResponses = new Map();
        this.getProfRegistry = [];
        this.resolveBlockResponses = new Map();
    }

    clear() {
        this.delegateResponses = new Map();
        this.sendResponses = new Map();
        this.sendErrors = new Map();
        this.delegateRegistry = [];
        this.sendRegistry = [];
        this.debugCallResponses = new Map();
        this.debugCallRegistry = [];
        this.batchForBlockResponses = new Map();
        this.batchForBlockErrors = new Map();
        this.batchForBlockRegistry = [];
        this.getProfResponses = new Map();
        this.getProfRegistry = [];
        this.resolveBlockResponses = new Map();
    }

    registerDelegate(id: string, response: JsonRpcResponse) {
        if (this.delegateResponses.has(id)) {
            throw new Error(`Response for ${id} already registered`);
        }
        this.delegateResponses.set(id, response);
    }

    registerSend(id: string, response: JSONLike) {
        if (this.isSendRegistered(id)) {
            throw new Error(`Response for ${id} already registered`);
        }
        this.sendResponses.set(id, response);
    }

    registerSendError(id: string, err: Error) {
        if (this.isSendRegistered(id)) {
            throw new Error(`Response for ${id} already registered`);
        }
        this.sendErrors.set(id, err);
    }

    private isSendRegistered(id: string) {
        return this.sendResponses.has(id) || this.sendErrors.has(id);
    }

    delegate(
        id: JsonRpcRequest['id'],
        method: JsonRpcRequest['method'],
        params: JsonRpcRequest['params']
    ): Promise<JsonRpcResponse> {
        const res = this.delegateResponses.get(id.toString());
        if (res === undefined) {
            throw new Error(`Response for delegate ${id} not registered`);
        }
        this.delegateRegistry.push({ id: id.toString(), method, params });
        return Promise.resolve(res);
    }

    async submitRawTransaction(id: JsonRpcRequest['id'], rawTx: Hex): Promise<JsonRpcResponse> {
        return submitRawTransactionUpstream(this, id, rawTx);
    }

    knownTransactions: Set<string> = new Set();

    registerKnownTransaction(txHash: Hex) {
        this.knownTransactions.add(txHash);
    }

    transactionIsKnown(_id: string, txHash: Hex): Promise<boolean> {
        return Promise.resolve(this.knownTransactions.has(txHash));
    }

    deployReceiptContractAddresses: Map<string, Address | null> = new Map();

    registerDeployReceiptContractAddress(txHash: Hex, address: Address | null) {
        this.deployReceiptContractAddresses.set(txHash, address);
    }

    deployReceiptContractAddress(_id: string, txHash: Hex): Promise<Address | null> {
        return Promise.resolve(this.deployReceiptContractAddresses.get(txHash) ?? null);
    }

    send<T extends ZodTypeAny>(id: number | string, method: string, params: unknown[], schema: T): Promise<TypeOf<T>> {
        const err = this.sendErrors.get(id.toString());
        if (err) {
            throw err;
        }

        const res = this.sendResponses.get(id.toString());
        if (res === undefined) {
            throw new Error(`Response for send ${id} not registered`);
        }
        this.sendRegistry.push({ id: id.toString(), method, params });
        return Promise.resolve(schema.parse(res));
    }

    getBalanceFor(_id: string, address: Address, _block?: BlockTag): Promise<Hex> {
        const balance = this.balances.get(address);
        if (balance === undefined) {
            throw new Error(`Balance for address ${address} not registered`);
        }
        return Promise.resolve(balance);
    }

    registerBalanceFor(address: Address, balance: Hex): void {
        this.balances.set(address, balance);
    }

    getCodeFor(_id: string, address: Address, _block?: BlockTag): Promise<Hex> {
        return Promise.resolve(this.codes.get(address)!);
    }

    registerCodeFor(address: Address, code: Hex): void {
        this.codes.set(address, code);
    }

    viemPublicClient(): PublicClient {
        return createMockRpcClient();
    }

    async isContract(address: Address, _id?: string): Promise<boolean> {
        const code = this.codes.get(address);
        if (code === undefined) {
            return false;
        }

        return size(code) > 0;
    }

    nonceFor(address: Address, _id?: string, _block?: BlockTag): Promise<bigint> {
        return Promise.resolve(this.nonces.get(address) ?? 0n);
    }

    registeredChainId = 271;

    chainId(_id?: string): Promise<number> {
        return Promise.resolve(this.registeredChainId);
    }

    setNonceFor(address: `0x${string}`, number: bigint) {
        this.nonces.set(address, number);
    }

    registerDebugCall(id: string, response: JSONLike) {
        this.debugCallResponses.set(id, response);
    }

    registerBatchForBlock(id: string, batchNumber: number) {
        this.batchForBlockResponses.set(id, batchNumber);
    }

    registerBatchForBlockError(id: string, err: Error) {
        this.batchForBlockErrors.set(id, err);
    }

    registerResolveBlockNumber(id: string, blockNumber: Hex) {
        this.resolveBlockResponses.set(id, blockNumber);
    }

    registerGetProf(id: string, response: ZksGetProofResponse) {
        this.getProfResponses.set(id, response);
    }

    debugCall<T extends ZodTypeAny>(
        id: string | number,
        from: Address,
        to: Address,
        callData: Hex,
        blockNumber: BlockTag,
        _tracerStr: string,
        responseSchema: T
    ): Promise<TypeOf<T>> {
        const res = this.debugCallResponses.get(id.toString());
        if (res === undefined) {
            throw new Error(`Response for debugCall ${id} not registered`);
        }
        this.debugCallRegistry.push({ id, from, to, callData, blockNumber });
        return Promise.resolve(responseSchema.parse(res));
    }

    private resolveBlockTag(id: string | number): Hex {
        const resolveId = `${id}_resolve`;
        const resolved = this.resolveBlockResponses.get(resolveId);
        if (resolved === undefined) {
            throw new Error(`Response for resolveBlockNumber ${resolveId} not registered`);
        }
        return resolved;
    }

    batchForBlock(id: string, block: BlockTag | Hex): Promise<{ batchNumber: number; blockNumber: Hex }> {
        const blockNumber: Hex = block.startsWith('0x') ? (block as Hex) : this.resolveBlockTag(id);
        this.batchForBlockRegistry.push({ id, block, blockNumber });
        const err = this.batchForBlockErrors.get(id);
        if (err) {
            throw err;
        }
        const batchNumber = this.batchForBlockResponses.get(id);
        if (batchNumber === undefined) {
            throw new Error(`Response for batchForBlock ${id} not registered`);
        }
        return Promise.resolve({ batchNumber, blockNumber });
    }

    getProf(id: string, address: Hex, slotList: Hex[], batchNumber: number): Promise<ZksGetProofResponse> {
        const res = this.getProfResponses.get(id);
        if (res === undefined) {
            throw new Error(`Response for getProf ${id} not registered`);
        }
        this.getProfRegistry.push({ id, address, slotList, batchNumber });
        return Promise.resolve(res);
    }
}
