import { selectChain } from '@repo/api-kit';
import { evmChainDefinition } from '#chains/evm/index';

selectChain(evmChainDefinition('zksync-os'));
