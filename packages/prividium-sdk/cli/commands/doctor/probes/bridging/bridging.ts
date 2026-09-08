import { decodeFunctionResult, encodeFunctionData, parseAbiItem } from 'viem';
import { requireRpcResult } from '../../clients/rpc.js';
import type { DoctorContext, ProbeOutput } from '../../types.js';

const DOCTOR_DIAGNOSTIC_CONTRACT = '0x0000000000000000000000000000000000010004';
const doctorDiagnosticAbi = [
    parseAbiItem('function L1_CHAIN_ID() view returns (uint256)'),
    parseAbiItem('function BASE_TOKEN_ASSET_ID() view returns (bytes32)'),
    parseAbiItem('function WETH_TOKEN() view returns (address)'),
    parseAbiItem('function originChainId(bytes32 assetId) view returns (uint256)')
];

export async function runBridgingL1ChainIdProbe(ctx: DoctorContext, walletAddress: string): Promise<ProbeOutput> {
    const value = await readContract(ctx, walletAddress, 'L1_CHAIN_ID');
    return { values: [{ label: 'l1ChainId', value: String(value), inline: true }] };
}

export async function runBridgingBaseTokenProbe(ctx: DoctorContext, walletAddress: string): Promise<ProbeOutput> {
    const value = await readContract(ctx, walletAddress, 'BASE_TOKEN_ASSET_ID');
    return { values: [{ label: 'baseTokenAssetId', value: String(value), inline: true }] };
}

export async function runBridgingWethTokenProbe(ctx: DoctorContext, walletAddress: string): Promise<ProbeOutput> {
    const value = await readContract(ctx, walletAddress, 'WETH_TOKEN');
    return { values: [{ label: 'wethToken', value: String(value), inline: true }] };
}

export async function runBridgingOriginChainIdProbe(ctx: DoctorContext, walletAddress: string): Promise<ProbeOutput> {
    const baseTokenAssetId = ctx.results
        .find((r) => r.id === `bridging-base-token:${walletAddress}`)
        ?.values?.find((v) => v.label === 'baseTokenAssetId')?.value as `0x${string}`;
    const value = await readContract(ctx, walletAddress, 'originChainId', [baseTokenAssetId]);
    return { values: [{ label: 'originChainId', value: String(value), inline: true }] };
}

async function readContract(
    ctx: DoctorContext,
    walletAddress: string,
    functionName: 'L1_CHAIN_ID' | 'BASE_TOKEN_ASSET_ID' | 'WETH_TOKEN' | 'originChainId',
    args: readonly unknown[] = []
): Promise<bigint | string> {
    const result = await requireRpcResult(ctx.targets!.apiBaseUrl, {
        method: 'eth_call',
        token: ctx.authState!.token,
        params: [
            {
                to: DOCTOR_DIAGNOSTIC_CONTRACT,
                from: walletAddress,
                data: encodeFunctionData({ abi: doctorDiagnosticAbi, functionName, args: args as never })
            },
            'latest'
        ]
    });
    return decodeFunctionResult({ abi: doctorDiagnosticAbi, functionName, data: result as `0x${string}` });
}
