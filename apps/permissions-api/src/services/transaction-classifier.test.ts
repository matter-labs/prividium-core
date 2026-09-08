import type { Address, Hex } from 'viem';
import { beforeEach, describe, expect, it } from 'vitest';
import { TestExternalRpc } from '../../test/rpc/test-external-rpc';
import { TransactionClassifier } from './transaction-classifier';

const TO = '0x1111111111111111111111111111111111111111' as Address;
const BYTECODE = '0x60806040' as Hex;

describe('TransactionClassifier', () => {
    let externalRpc: TestExternalRpc;
    let classifier: TransactionClassifier;

    beforeEach(() => {
        externalRpc = new TestExternalRpc();
        classifier = new TransactionClassifier(externalRpc);
    });

    describe('empty', () => {
        it('classifies a tx with no calldata and no value to a recipient as empty', async () => {
            expect(await classifier.classifyTransaction(TO, '0x', 0n)).toEqual({ type: 'empty', toAddress: TO });
        });

        it('takes precedence over deployment when there is no recipient, calldata, nor value', async () => {
            // The `empty` guard runs before the deployment guard, so a null
            // recipient with neither calldata nor value is still `empty`.
            expect(await classifier.classifyTransaction(null, '0x', 0n)).toEqual({ type: 'empty', toAddress: null });
        });
    });

    describe('deployment', () => {
        it('classifies a creation tx (no recipient, has init code) as deployment', async () => {
            expect(await classifier.classifyTransaction(null, BYTECODE, 0n)).toEqual({
                type: 'deployment',
                toAddress: null
            });
        });

        it('classifies a creation tx carrying value as deployment', async () => {
            expect(await classifier.classifyTransaction(null, BYTECODE, 5n)).toEqual({
                type: 'deployment',
                toAddress: null
            });
        });
    });

    describe('transfer-to-eoa', () => {
        it('classifies a bare value transfer to a non-contract recipient as transfer-to-eoa', async () => {
            // Recipient has no registered code -> isContract() is false.
            expect(await classifier.classifyTransaction(TO, '0x', 5n)).toEqual({
                type: 'transfer-to-eoa',
                toAddress: TO
            });
        });
    });

    describe('transfer-to-contract', () => {
        it('classifies a bare value transfer to a contract recipient as transfer-to-contract', async () => {
            externalRpc.registerCodeFor(TO, BYTECODE);
            expect(await classifier.classifyTransaction(TO, '0x', 5n)).toEqual({
                type: 'transfer-to-contract',
                toAddress: TO
            });
        });
    });

    describe('contract-call', () => {
        it('classifies calldata sent to a recipient as contract-call', async () => {
            expect(await classifier.classifyTransaction(TO, BYTECODE, 0n)).toEqual({
                type: 'contract-call',
                toAddress: TO
            });
        });
    });
});
