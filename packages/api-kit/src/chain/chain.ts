import type * as z from 'zod/v4';

/** An address on the deployment's chain. One address can have several spellings: compare with `areChainAddressesEqual`. */
export type ChainAddress = string;

export interface AddressCodec {
    /** Parses request input into the canonical form, the one spelling of an address; refuses anything else. */
    readonly schema: z.ZodType<ChainAddress, string>;
    /** Matches every canonical address `schema` and `fromBytes` produce. */
    readonly pattern: RegExp;
    /** True for two spellings of one address; two canonical addresses are equal as strings. */
    equals(a: ChainAddress, b: ChainAddress): boolean;
    /** Throws a ZodError for anything that is not an address on this chain, which the API answers with a 400. */
    toBytes(address: ChainAddress): Uint8Array;
    /** Returns the canonical form. */
    fromBytes(bytes: Uint8Array): ChainAddress;
}

/** What the chain supports of the core's optional machinery; boot refuses settings that need more. */
export type ChainCapabilities = {
    /** Users sign in with wallets of this chain, and wallet lists in the configuration name its addresses. */
    readonly walletSignIn: boolean;
    readonly faucet: boolean;
    /** The chain calls back to /admit and /judge to check each transaction before including it. */
    readonly sequencerCallbacks: boolean;
    /** The node serves the proofs and tracers the disclosure RPC methods are built on. */
    readonly disclosureMethods: boolean;
};

/** A contract every network of the chain holds at a fixed address; boot registers it with public access rules. */
export type SystemContract = {
    readonly address: ChainAddress;
    readonly name: string;
    readonly description: string | null;
    readonly abi: string;
    readonly discloseBytecode: boolean;
    readonly discloseErc20TotalSupply: boolean;
};

export interface ChainDefinition {
    /** The module's name; a shipped id never changes. */
    readonly id: string;
    readonly addresses: AddressCodec;
    readonly capabilities: ChainCapabilities;
    readonly systemContracts: readonly SystemContract[];
}

export interface ChainNode {
    /** False when nothing is deployed there; rejects only when the chain cannot answer. */
    contractExists(address: ChainAddress): Promise<boolean>;
    /** True when the chain has never seen the account, so it can be bound to a user as a fresh wallet. */
    accountIsUnused(address: ChainAddress): Promise<boolean>;
}

export interface Chain extends ChainDefinition, ChainNode {}

export type ChainEnv = Readonly<Record<string, string | undefined>>;

declare const chainTypeBrand: unique symbol;
/** A `TARGET_CHAIN_TYPE` value a registered module serves; only the core's chain registry creates one. */
export type ChainType = string & { readonly [chainTypeBrand]: true };

export interface ChainModule<T extends string = string> {
    readonly id: string;
    /** The `TARGET_CHAIN_TYPE` values this module serves; a shipped value never changes. */
    readonly chainTypes: readonly T[];
    /** Reads the module's settings from `env` and connects to the node; `chainType` is one of `chainTypes`. */
    connect(options: { nodeUrl: string; chainType: T; env: ChainEnv }): Promise<Chain>;
}

/**
 * Registers a module without loading it: it loads only once `TARGET_CHAIN_TYPE` names one of its chain types, so
 * other deployments never load its code or dependencies.
 */
export interface ChainModuleRef {
    readonly id: string;
    /** Repeated here, so the core maps a chain type to its module before loading any. */
    readonly chainTypes: readonly string[];
    load(): Promise<ChainModule>;
}
