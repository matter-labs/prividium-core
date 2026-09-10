import { eq } from 'drizzle-orm';
import pino from 'pino';
import { type Abi, decodeFunctionData, encodeFunctionData, parseAbi, toFunctionSelector } from 'viem';
import { describe, expect } from 'vitest';
import { it } from '../../../test/unit-test-context';
import { contractsTable } from '../../db/schema';
import { isSystemContractAddress, SYSTEM_CONTRACTS_REGISTRY } from './registry';
import { syncSystemContracts } from './sync';

const logger = pino({ level: 'silent' });
const INTEROP_CENTER = '0x000000000000000000000000000000000001000d';
// The signature zksync-js encodes for a v33 L2→L1 withdrawal bundle.
const SEND_BUNDLE = 'function sendBundle(bytes,(bytes,bytes,bytes[])[],bytes[]) payable returns (bytes32)';

describe('InteropCenter system contract', () => {
    it('is registered at the v33 predeploy address', () => {
        const entry = SYSTEM_CONTRACTS_REGISTRY.find((c) => c.name === 'InteropCenter');
        expect(entry?.contractAddress).toBe(INTEROP_CENTER);
        expect(isSystemContractAddress(INTEROP_CENTER)).toBe(true);
    });

    it('carries an ABI that decodes the SDK withdrawal calldata', async ({ db }) => {
        await syncSystemContracts(db, logger);
        const row = await db.query.contractsTable.findFirst({
            where: eq(contractsTable.contractAddress, INTEROP_CENTER)
        });
        expect(row).toMatchObject({ name: 'InteropCenter', isSystemContract: true, templateId: null });

        const calldata = encodeFunctionData({
            abi: parseAbi([SEND_BUNDLE]),
            functionName: 'sendBundle',
            args: ['0x0001000003aa36a7', [['0x0001000000140000000000000000000000000000000000010003', '0x1234', []]], []]
        });
        expect(calldata.slice(0, 10)).toBe(toFunctionSelector(SEND_BUNDLE));
        expect(calldata.slice(0, 10)).toBe('0x5ef7e104');
        expect(decodeFunctionData({ abi: JSON.parse(row!.abi) as Abi, data: calldata })).toMatchObject({
            functionName: 'sendBundle',
            args: [
                '0x0001000003aa36a7',
                [{ to: '0x0001000000140000000000000000000000000000000000010003', data: '0x1234', callAttributes: [] }],
                []
            ]
        });
    });

    it('keeps the v31 withdrawal entrypoints for chains that have not upgraded', () => {
        const byName = new Map(SYSTEM_CONTRACTS_REGISTRY.map((c) => [c.name, JSON.parse(c.abi) as Abi]));
        const functionNames = (abi: Abi) => abi.filter((i) => i.type === 'function').map((i) => i.name);
        expect(functionNames(byName.get('L2BaseToken')!)).toContain('withdraw');
        expect(functionNames(byName.get('L2AssetRouter')!)).toContain('withdraw');
    });
});
