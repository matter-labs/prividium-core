import type { DoctorContext, DoctorStageDefinition } from '../types.js';
import { passed, shortenAddress } from '../utils.js';
import {
    runBridgingBaseTokenProbe,
    runBridgingL1ChainIdProbe,
    runBridgingOriginChainIdProbe,
    runBridgingWethTokenProbe
} from './bridging/bridging.js';

export function createBridgingStage(walletAddress: string): DoctorStageDefinition {
    return {
        id: 'bridging',
        title: `Bridging · (using: ${shortenAddress(walletAddress)})`,
        getProbes: () => [
            {
                id: `bridging-l1-chain-id:${walletAddress}`,
                label: 'L1 chain ID',
                progressMessage: `Bridging checks: ${walletAddress}`,
                run: (ctx: DoctorContext) => runBridgingL1ChainIdProbe(ctx, walletAddress)
            },
            {
                id: `bridging-base-token:${walletAddress}`,
                label: 'Base token asset ID',
                run: (ctx: DoctorContext) => runBridgingBaseTokenProbe(ctx, walletAddress)
            },
            {
                id: `bridging-weth:${walletAddress}`,
                label: 'WETH token',
                run: (ctx: DoctorContext) => runBridgingWethTokenProbe(ctx, walletAddress)
            },
            {
                id: `bridging-origin-chain-id:${walletAddress}`,
                label: 'Origin chain ID',
                runIf: passed(`bridging-base-token:${walletAddress}`, 'BASE_TOKEN_ASSET_ID check did not pass'),
                run: (ctx: DoctorContext) => runBridgingOriginChainIdProbe(ctx, walletAddress)
            }
        ]
    };
}
