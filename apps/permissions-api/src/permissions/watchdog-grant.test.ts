import {
    type AbiFunction,
    type Address,
    concat,
    type EncodeFunctionDataParameters,
    encodeAbiParameters,
    encodeFunctionData,
    type Hex,
    pad,
    parseAbiItem,
    parseAbiParameters,
    toEventSelector,
    toFunctionSelector,
    zeroAddress
} from 'viem';
import { describe, expect, it } from 'vitest';
import {
    couldMatchWatchdogLogs,
    decideWatchdogCall,
    decideWatchdogFrame,
    decideWatchdogTransfer,
    isWatchdogLog,
    WATCHDOG_GRANT
} from './watchdog-grant';

const own: Address = '0x1111111111111111111111111111111111111111';
const foreign: Address = '0x2222222222222222222222222222222222222222';
const wallets = [{ walletAddress: own }];

const L2_BASE_TOKEN: Address = '0x000000000000000000000000000000000000800A';
const L2_ASSET_ROUTER: Address = '0x0000000000000000000000000000000000010003';
const L2_NATIVE_TOKEN_VAULT: Address = '0x0000000000000000000000000000000000010004';
const INTEROP_CENTER: Address = '0x000000000000000000000000000000000001000d';
const L1_MESSENGER: Address = '0x0000000000000000000000000000000000008008';
const ASSET_TRACKER: Address = '0x000000000000000000000000000000000001000f';
const SEND_BUNDLE =
    'function sendBundle(bytes, (bytes to, bytes data, bytes[] callAttributes)[], bytes[]) payable returns (bytes32)';

const GRANTED = { authorized: true, ruleId: 'watchdog.grant', exemptFromOverlays: true };
const NOT_GRANTED = { authorized: false, ruleId: 'watchdog.not_granted' };
const FOREIGN_RECIPIENT = { authorized: false, ruleId: 'watchdog.foreign_recipient' };
const NOT_ITS_WALLET = { authorized: false, ruleId: 'wallet.not_owned_by_user' };

const call = (signature: string, args: readonly unknown[] = []): Hex =>
    encodeFunctionData({ abi: [parseAbiItem(signature) as AbiFunction], args } as EncodeFunctionDataParameters);

const withdraw = (receiver: Address) => call('function withdraw(address _l1Receiver) payable', [receiver]);

function bundle(
    receiver: Address,
    {
        target = L2_ASSET_ROUTER,
        calls = 1,
        token = zeroAddress
    }: { target?: Address; calls?: number; token?: Address } = {}
): Hex {
    const burnData = encodeAbiParameters(parseAbiParameters('uint256, address, address'), [1n, receiver, token]);
    const starter = {
        to: concat(['0x000100000014', target]),
        data: concat(['0x01', encodeAbiParameters(parseAbiParameters('bytes32, bytes'), [pad('0x01'), burnData])]),
        callAttributes: []
    };
    return call(SEND_BUNDLE, ['0x000100000101', Array.from({ length: calls }, () => starter), []]);
}

const decide = (contractAddress: Address, calldata: Hex, from: Address = own) =>
    decideWatchdogCall(wallets, { from, contractAddress, calldata });

describe('decideWatchdogCall', () => {
    it.each([
        'function BASE_TOKEN_ASSET_ID() view returns (bytes32)',
        'function L1_CHAIN_ID() view returns (uint256)',
        'function WETH_TOKEN() view returns (address)'
    ])('grants the token lookup %s', (signature) => {
        expect(decide(L2_NATIVE_TOKEN_VAULT, call(signature))).toEqual(GRANTED);
    });

    it('grants the origin chain lookup', () => {
        expect(decide(L2_NATIVE_TOKEN_VAULT, call('function originChainId(bytes32)', [pad('0x01')]))).toEqual(GRANTED);
    });

    it('grants a v31 withdrawal to its own L1 address only', () => {
        expect(decide(L2_BASE_TOKEN, withdraw(own))).toEqual(GRANTED);
        expect(decide(L2_BASE_TOKEN, withdraw(foreign))).toEqual(FOREIGN_RECIPIENT);
    });

    it('grants a v33 base token withdrawal bundle to its own L1 address only', () => {
        expect(decide(INTEROP_CENTER, bundle(own))).toEqual(GRANTED);
        expect(decide(INTEROP_CENTER, bundle(foreign))).toEqual(FOREIGN_RECIPIENT);
    });

    it('refuses a bundle for another token, another target, more calls, or no arguments', () => {
        expect(decide(INTEROP_CENTER, bundle(own, { token: foreign }))).toEqual(FOREIGN_RECIPIENT);
        expect(decide(INTEROP_CENTER, bundle(own, { target: L2_BASE_TOKEN }))).toEqual(FOREIGN_RECIPIENT);
        expect(decide(INTEROP_CENTER, bundle(own, { calls: 2 }))).toEqual(FOREIGN_RECIPIENT);
        expect(decide(INTEROP_CENTER, toFunctionSelector(SEND_BUNDLE))).toEqual(FOREIGN_RECIPIENT);
    });

    it('refuses any other call and a signer that is not its wallet', () => {
        expect(decide(L2_NATIVE_TOKEN_VAULT, call('function ensureTokenIsRegistered(address)', [own]))).toEqual(
            NOT_GRANTED
        );
        expect(decide(foreign, withdraw(own))).toEqual(NOT_GRANTED);
        expect(decide(L2_BASE_TOKEN, withdraw(own), foreign)).toEqual(NOT_ITS_WALLET);
    });

    it('sends value without calldata to its own wallets only', () => {
        expect(decide(own, '0x')).toEqual(GRANTED);
        expect(decide(foreign, '0x')).toEqual(FOREIGN_RECIPIENT);
        expect(decide(INTEROP_CENTER, '0x')).toEqual(FOREIGN_RECIPIENT);
    });

    it('lists every granted call for the admin panel', () => {
        expect(WATCHDOG_GRANT.calls).toEqual([
            {
                contract: L2_NATIVE_TOKEN_VAULT,
                function: expect.stringContaining('BASE_TOKEN_ASSET_ID'),
                ownRecipientOnly: false
            },
            {
                contract: L2_NATIVE_TOKEN_VAULT,
                function: expect.stringContaining('L1_CHAIN_ID'),
                ownRecipientOnly: false
            },
            {
                contract: L2_NATIVE_TOKEN_VAULT,
                function: expect.stringContaining('WETH_TOKEN'),
                ownRecipientOnly: false
            },
            {
                contract: L2_NATIVE_TOKEN_VAULT,
                function: expect.stringContaining('originChainId'),
                ownRecipientOnly: false
            },
            { contract: L2_BASE_TOKEN, function: expect.stringContaining('withdraw'), ownRecipientOnly: true },
            { contract: INTEROP_CENTER, function: expect.stringContaining('sendBundle'), ownRecipientOnly: true }
        ]);
    });
});

describe('decideWatchdogFrame', () => {
    const frame = (contractAddress: Address, calldata: Hex, from: Address = own, systemReads = false) =>
        decideWatchdogFrame(wallets, { from, contractAddress, calldata }, systemReads);

    it('lets a withdrawal reach the system contracts it goes through', () => {
        expect(frame(L1_MESSENGER, call('function sendToL1(bytes)', ['0x']))).toEqual(GRANTED);
        expect(frame(L1_MESSENGER, '0x')).toEqual(GRANTED);
        expect(frame(L2_NATIVE_TOKEN_VAULT, call('function bridgeBurn(uint256)', [1n]))).toEqual(GRANTED);
    });

    it('refuses a system contract method outside its umbrella policy', () => {
        const interopInfo = call('function interopInfo(bytes32)', [pad('0x01')]);

        expect(frame(L1_MESSENGER, call('function withdraw(address)', [own]))).toEqual(NOT_GRANTED);
        expect(frame(ASSET_TRACKER, interopInfo)).toEqual(NOT_GRANTED);
        expect(frame(ASSET_TRACKER, interopInfo, own, true)).toEqual(GRANTED);
    });

    it('refuses any contract outside the system contract registry', () => {
        expect(frame(foreign, call('function balanceOf(address)', [own]))).toEqual(NOT_GRANTED);
        expect(frame(foreign, '0x')).toEqual(NOT_GRANTED);
    });

    it('refuses a signer that is not its wallet', () => {
        expect(frame(L1_MESSENGER, '0x', foreign)).toEqual(NOT_ITS_WALLET);
    });
});

describe('decideWatchdogTransfer', () => {
    it('grants a native transfer to its own wallets only', () => {
        expect(decideWatchdogTransfer(wallets, own)).toEqual(GRANTED);
        expect(decideWatchdogTransfer(wallets, foreign)).toEqual(FOREIGN_RECIPIENT);
    });
});

describe('watchdog logs', () => {
    const withdrawal = toEventSelector('event Withdrawal(address indexed, address indexed, uint256)');
    const log = (address: Hex, topics: Hex[]) => ({ address, topics });

    it('shows only withdrawals the watchdog sent', () => {
        expect(isWatchdogLog(wallets, log(L2_BASE_TOKEN, [withdrawal, pad(own), pad(own)]))).toBe(true);
        expect(isWatchdogLog(wallets, log(L2_BASE_TOKEN, [withdrawal, pad(foreign), pad(own)]))).toBe(false);
        expect(isWatchdogLog(wallets, log(L2_BASE_TOKEN, [pad('0x01'), pad(own)]))).toBe(false);
        expect(isWatchdogLog(wallets, log(foreign, [withdrawal, pad(own), pad(own)]))).toBe(false);
    });

    it('queries the node only for a filter that can match its withdrawals', () => {
        expect(couldMatchWatchdogLogs({ address: L2_BASE_TOKEN, topics: [withdrawal, pad(own), pad(own)] })).toBe(true);
        expect(couldMatchWatchdogLogs({ topics: [[pad('0x01'), withdrawal]] })).toBe(true);
        expect(couldMatchWatchdogLogs({ address: foreign })).toBe(false);
        expect(couldMatchWatchdogLogs({ topics: [pad('0x01')] })).toBe(false);
    });

    it('lists the event it filters by', () => {
        expect(WATCHDOG_GRANT.events).toEqual([
            { contract: L2_BASE_TOKEN, event: expect.stringContaining('Withdrawal'), ownSenderOnly: true }
        ]);
        expect(toEventSelector(WATCHDOG_GRANT.events[0]!.event)).toBe(withdrawal);
    });
});
