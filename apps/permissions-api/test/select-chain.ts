import { selectChain } from '@repo/api-kit';
import { evmChainDefinition } from '../src/chains/evm';

selectChain(evmChainDefinition('zksync-os'));
