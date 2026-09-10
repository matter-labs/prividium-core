import { eq } from 'drizzle-orm';
import pino from 'pino';
import { type Abi, decodeFunctionData, encodeFunctionData, parseAbi } from 'viem';
import { describe, expect } from 'vitest';
import { it } from '../../../test/unit-test-context';
import { Repositories } from '../../db';
import { contractsTable } from '../../db/schema';
import { AuthorizationService } from '../authorization-service';
import { isSystemContractAddress } from './registry';
import { syncSystemContracts } from './sync';

const interopCenter = '0x000000000000000000000000000000000001000d';
const wallet = '0x0000000000000000000000000000000000000001';
const logger = pino({ level: 'silent' });
const signature = 'function sendBundle(bytes,(bytes,bytes,bytes[])[],bytes[]) payable returns (bytes32)';
// Encode independently of the registry ABI, using the SDK's canonical sendBundle signature.
const calldata = encodeFunctionData({
    abi: parseAbi([signature]),
    functionName: 'sendBundle',
    args: ['0x0001000003aa36a7', [['0x0001000000140000000000000000000000000000000000010003', '0x1234', []]], []]
});

describe('InteropCenter system contract', () => {
    it('syncs the SDK-compatible ABI and reserves the address', async ({ db }) => {
        await syncSystemContracts(db, logger);
        const contract = await db.query.contractsTable.findFirst({
            where: eq(contractsTable.contractAddress, interopCenter)
        });
        expect(contract).toMatchObject({ name: 'InteropCenter', isSystemContract: true, templateId: null });
        expect(isSystemContractAddress(interopCenter)).toBe(true);
        expect(calldata.slice(0, 10)).toBe('0x5ef7e104');
        expect(decodeFunctionData({ abi: JSON.parse(contract!.abi) as Abi, data: calldata })).toMatchObject({
            functionName: 'sendBundle',
            args: [
                '0x0001000003aa36a7',
                [{ to: '0x0001000000140000000000000000000000000000000000010003', data: '0x1234', callAttributes: [] }],
                []
            ]
        });
    });

    it('supports an explicit withdrawal-role grant without authorizing other callers or methods', async ({ db }) => {
        const repos = new Repositories(db);
        await syncSystemContracts(db, logger);
        const role = await repos.roles.create({ roleName: 'withdrawal-operator', systemPermissions: [] });
        const user = await repos.users.create({
            displayName: 'Withdrawal operator',
            source: 'adminPanel',
            wallets: [wallet],
            roles: [role.id]
        });
        const auth = new AuthorizationService({ repos });
        const request = {
            fromAddress: wallet,
            user,
            contractAddress: interopCenter,
            calldata,
            accessTypeCheck: 'write'
        } as const;
        expect(await auth.checkMethodAuthorizationForUser(request)).toMatchObject({
            authorized: false,
            ruleId: 'permission.missing'
        });

        const permission = await repos.contractFunctionPermissions.create({
            contractAddress: interopCenter,
            functionSignature: signature,
            accessType: 'write',
            ruleType: 'checkRole',
            roles: [{ id: role.id }]
        });
        expect(permission.methodSelector).toBe('0x5ef7e104');
        // A restart must preserve the operator-managed permission.
        await syncSystemContracts(db, logger);
        for (const rpcMethod of ['eth_estimateGas', 'eth_sendRawTransaction']) {
            expect(await auth.checkMethodAuthorizationForUser({ ...request, rpcMethod })).toMatchObject({
                authorized: true,
                ruleId: 'rule.check_role.allow'
            });
        }
        expect(await auth.checkMethodAuthorizationForUser({ ...request, user: { ...user, roles: [] } })).toMatchObject({
            authorized: false,
            ruleId: 'rule.check_role.deny'
        });
        expect(await auth.checkMethodAuthorizationForUser({ ...request, calldata: '0x8456cb59' })).toMatchObject({
            authorized: false,
            ruleId: 'permission.missing'
        });
    });
});
