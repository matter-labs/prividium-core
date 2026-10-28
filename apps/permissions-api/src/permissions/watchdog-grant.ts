import { areChainAddressesEqual, type ChainAddress } from '@repo/api-kit';
import {
    type Address,
    concat,
    decodeAbiParameters,
    decodeFunctionData,
    type Hex,
    parseAbiItem,
    parseAbiParameters,
    size,
    slice,
    toEventSelector,
    toFunctionSelector,
    zeroAddress
} from 'viem';
import { isEvmAddress } from '../chains/evm/addresses';
import { ZKSYNC_SYSTEM_CONTRACTS } from '../chains/evm/system-contracts';
import { AddressSet } from '../rpc/address-set';
import type { GetLogsFilter } from '../rpc/methods/handlers';
import type { LogData } from '../rpc/permissions/authorizer';
import type { AuthorizationResult } from '../services/authorization-service';
import { canInheritSystemContractUmbrella } from '../services/system-contracts/umbrella-policy';
import { areHexEqual } from '../utils/hex';

type Wallets = readonly { walletAddress: ChainAddress }[];

const L2_BASE_TOKEN: Address = '0x000000000000000000000000000000000000800A';
const L2_ASSET_ROUTER: Address = '0x0000000000000000000000000000000000010003';
const L2_NATIVE_TOKEN_VAULT: Address = '0x0000000000000000000000000000000000010004';
const INTEROP_CENTER: Address = '0x000000000000000000000000000000000001000d';

const WITHDRAW = parseAbiItem('function withdraw(address _l1Receiver) payable');
const SEND_BUNDLE = parseAbiItem(
    'function sendBundle(bytes _destinationChainId, (bytes to, bytes data, bytes[] callAttributes)[] _callStarters, bytes[] _bundleAttributes) payable returns (bytes32)'
);
const ASSET_ROUTER_DATA = parseAbiParameters('bytes32 assetId, bytes burnData');
const BASE_TOKEN_BURN_DATA = parseAbiParameters('uint256 amount, address receiver, address token');
// The AssetRouter's ERC-7930 interoperable address.
const ASSET_ROUTER_TARGET = concat(['0x000100000014', L2_ASSET_ROUTER]);

const SYSTEM_CONTRACTS = new AddressSet(
    ZKSYNC_SYSTEM_CONTRACTS.map((contract) => contract.address).filter(isEvmAddress)
);

const GRANTED_EVENT = {
    contract: L2_BASE_TOKEN,
    event: 'event Withdrawal(address indexed _l2Sender, address indexed _l1Receiver, uint256 _amount)'
};
const GRANTED_EVENT_TOPIC = toEventSelector(GRANTED_EVENT.event);

const grantedCall = (contract: Address, signature: string, recipient?: (calldata: Hex) => Address | undefined) => ({
    contract,
    signature,
    selector: toFunctionSelector(signature),
    recipient
});

const GRANTED_CALLS = [
    grantedCall(L2_NATIVE_TOKEN_VAULT, 'function BASE_TOKEN_ASSET_ID() view returns (bytes32)'),
    grantedCall(L2_NATIVE_TOKEN_VAULT, 'function L1_CHAIN_ID() view returns (uint256)'),
    grantedCall(L2_NATIVE_TOKEN_VAULT, 'function WETH_TOKEN() view returns (address)'),
    grantedCall(L2_NATIVE_TOKEN_VAULT, 'function originChainId(bytes32) view returns (uint256)'),
    grantedCall(L2_BASE_TOKEN, 'function withdraw(address _l1Receiver) payable', withdrawRecipient),
    grantedCall(
        INTEROP_CENTER,
        'function sendBundle(bytes,(bytes,bytes,bytes[])[],bytes[]) payable returns (bytes32)',
        bundleRecipient
    )
];

export const WATCHDOG_GRANT = {
    rpcMethods: [
        'eth_chainId',
        'eth_blockNumber',
        'eth_gasPrice',
        'eth_maxPriorityFeePerGas',
        'eth_getBalance',
        'eth_getTransactionCount',
        'eth_getCode',
        'eth_call',
        'eth_estimateGas',
        'eth_sendRawTransaction',
        'eth_getBlockByNumber',
        'eth_getBlockByHash',
        'eth_getTransactionByHash',
        'eth_getTransactionReceipt',
        'eth_getLogs',
        'zks_getBridgehubContract',
        'zks_getL2ToL1LogProof'
    ],
    calls: GRANTED_CALLS.map((call) => ({
        contract: call.contract,
        function: call.signature,
        ownRecipientOnly: call.recipient !== undefined
    })),
    events: [{ ...GRANTED_EVENT, ownSenderOnly: true }]
};

export const WATCHDOG_PUBLIC_CODE_ADDRESSES = SYSTEM_CONTRACTS.all();

export const WATCHDOG_NOT_GRANTED: AuthorizationResult = { authorized: false, ruleId: 'watchdog.not_granted' };
const GRANTED: AuthorizationResult = { authorized: true, ruleId: 'watchdog.grant', exemptFromOverlays: true };
const FOREIGN_RECIPIENT: AuthorizationResult = { authorized: false, ruleId: 'watchdog.foreign_recipient' };
const NOT_ITS_WALLET: AuthorizationResult = { authorized: false, ruleId: 'wallet.not_owned_by_user' };

export function decideWatchdogCall(
    wallets: Wallets,
    call: { from: Address | undefined; contractAddress: Address; calldata: Hex }
): AuthorizationResult {
    if (call.from === undefined || !isOwnWallet(wallets, call.from)) {
        return NOT_ITS_WALLET;
    }
    if (size(call.calldata) === 0) {
        return decideWatchdogTransfer(wallets, call.contractAddress);
    }

    const selector = slice(call.calldata, 0, 4);
    const granted = GRANTED_CALLS.find(
        (candidate) =>
            areHexEqual(candidate.contract, call.contractAddress) && areHexEqual(candidate.selector, selector)
    );
    if (granted === undefined) {
        return WATCHDOG_NOT_GRANTED;
    }
    if (granted.recipient === undefined) {
        return GRANTED;
    }
    const recipient = granted.recipient(call.calldata);
    return recipient !== undefined && isOwnWallet(wallets, recipient) ? GRANTED : FOREIGN_RECIPIENT;
}

export function decideWatchdogFrame(
    wallets: Wallets,
    frame: { from: Address | undefined; contractAddress: Address; calldata: Hex },
    allowUmbrellaSystemReads: boolean
): AuthorizationResult {
    if (frame.from === undefined || !isOwnWallet(wallets, frame.from)) {
        return NOT_ITS_WALLET;
    }
    const selector = size(frame.calldata) === 0 ? '0x' : slice(frame.calldata, 0, 4);
    return SYSTEM_CONTRACTS.has(frame.contractAddress) &&
        canInheritSystemContractUmbrella(frame.contractAddress, selector, allowUmbrellaSystemReads)
        ? GRANTED
        : WATCHDOG_NOT_GRANTED;
}

export function decideWatchdogTransfer(wallets: Wallets, to: Address): AuthorizationResult {
    return isOwnWallet(wallets, to) ? GRANTED : FOREIGN_RECIPIENT;
}

export function isWatchdogLog(wallets: Wallets, log: LogData): boolean {
    const sender = log.topics[1];
    return (
        areHexEqual(log.address, GRANTED_EVENT.contract) &&
        log.topics[0] !== undefined &&
        areHexEqual(log.topics[0], GRANTED_EVENT_TOPIC) &&
        sender !== undefined &&
        size(sender) === 32 &&
        isOwnWallet(wallets, slice(sender, 12))
    );
}

export function couldMatchWatchdogLogs(filter: GetLogsFilter): boolean {
    const addresses = filter.address === undefined ? undefined : [filter.address].flat();
    const topic0 = filter.topics?.[0];
    const events = topic0 === undefined || topic0 === null ? undefined : [topic0].flat();
    return (
        (addresses === undefined || addresses.some((address) => areHexEqual(address, GRANTED_EVENT.contract))) &&
        (events === undefined || events.some((event) => areHexEqual(event, GRANTED_EVENT_TOPIC)))
    );
}

function isOwnWallet(wallets: Wallets, address: Hex): boolean {
    return wallets.some((wallet) => areChainAddressesEqual(wallet.walletAddress, address));
}

function withdrawRecipient(calldata: Hex): Address | undefined {
    try {
        return decodeFunctionData({ abi: [WITHDRAW], data: calldata }).args[0];
    } catch {
        return undefined;
    }
}

// A base token withdrawal bundle has one call: the AssetRouter, given 0x01 ‖ (assetId, (amount, receiver, 0x0)).
function bundleRecipient(calldata: Hex): Address | undefined {
    try {
        const [, starters] = decodeFunctionData({ abi: [SEND_BUNDLE], data: calldata }).args;
        const [starter, ...others] = starters;
        if (
            starter === undefined ||
            others.length > 0 ||
            !areHexEqual(starter.to, ASSET_ROUTER_TARGET) ||
            !areHexEqual(slice(starter.data, 0, 1), '0x01')
        ) {
            return undefined;
        }
        const [, burnData] = decodeAbiParameters(ASSET_ROUTER_DATA, slice(starter.data, 1));
        const [, receiver, token] = decodeAbiParameters(BASE_TOKEN_BURN_DATA, burnData);
        return areHexEqual(token, zeroAddress) ? receiver : undefined;
    } catch {
        return undefined;
    }
}
