import { type Chain, type ChainEnv, type ChainModuleRef, type ChainType, selectChain } from '@repo/api-kit';
import { evmChainModule } from './evm';
import { type ChainSettings, findUnsupportedSettings } from './supported-settings';

export const CORE_CHAIN_MODULES: readonly ChainModuleRef[] = [
    { id: evmChainModule.id, chainTypes: evmChainModule.chainTypes, load: async () => evmChainModule }
];

/** The module behind each chain type this build serves; an id or a chain type claimed twice fails the boot. */
export function chainModules(registered: readonly ChainModuleRef[] = []): ReadonlyMap<string, ChainModuleRef> {
    const ids = new Set<string>();
    const byChainType = new Map<string, ChainModuleRef>();
    for (const module of [...CORE_CHAIN_MODULES, ...registered]) {
        if (ids.has(module.id)) {
            throw new Error(`Two chain modules are registered as '${module.id}'`);
        }
        ids.add(module.id);
        for (const chainType of module.chainTypes) {
            const other = byChainType.get(chainType);
            if (other !== undefined) {
                throw new Error(
                    `Chain modules '${other.id}' and '${module.id}' both serve TARGET_CHAIN_TYPE='${chainType}'`
                );
            }
            byChainType.set(chainType, module);
        }
    }
    return byChainType;
}

type ConnectOptions = { nodeUrl: string; env: ChainEnv; settings: ChainSettings };

export type ChainRegistry = {
    /** The only place a `ChainType` is created; fails the boot on a value no registered module serves. */
    parse(raw: string): ChainType;
    /** Loads the module behind the type, connects, refuses settings the chain cannot honour and selects the chain. */
    connect(chainType: ChainType, options: ConnectOptions): Promise<Chain>;
};

export function chainRegistry(registered: readonly ChainModuleRef[] = []): ChainRegistry {
    const modules = chainModules(registered);
    const moduleFor = (chainType: string): ChainModuleRef => {
        const ref = modules.get(chainType);
        if (ref === undefined) {
            throw new Error(
                `TARGET_CHAIN_TYPE='${chainType}' is not a chain type this build serves; it serves: ${[...modules.keys()].join(', ')}`
            );
        }
        return ref;
    };
    return {
        parse(raw) {
            moduleFor(raw);
            return raw as ChainType;
        },
        async connect(chainType, options) {
            const ref = moduleFor(chainType);
            const module = await ref.load();
            if (module.id !== ref.id) {
                throw new Error(`The chain module registered as '${ref.id}' loaded as '${module.id}'`);
            }
            if (!module.chainTypes.includes(chainType)) {
                throw new Error(
                    `The '${module.id}' chain module does not serve TARGET_CHAIN_TYPE='${chainType}'; it serves: ${module.chainTypes.join(', ')}`
                );
            }
            const chain = await module.connect({ nodeUrl: options.nodeUrl, chainType, env: options.env });
            const unsupportedSettings = findUnsupportedSettings(chainType, chain.capabilities, options.settings);
            if (unsupportedSettings !== undefined) {
                throw new Error(unsupportedSettings);
            }
            selectChain(chain);
            return chain;
        }
    };
}
