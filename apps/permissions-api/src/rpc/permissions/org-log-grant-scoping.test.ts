import pino from 'pino';
import { pad, parseAbi } from 'viem';
import { describe, expect } from 'vitest';
import { type DB, Repositories } from '#db/index';
import { AuthData } from '#middleware/auth-data';
import type { SystemPermission } from '#permissions/system-permissions';
import type { UserWithRoles } from '#repositories/users-repository';
import { eth_getLogs } from '#rpc/methods/handlers/eth_getLogs';
import { eth_getTransactionByHash } from '#rpc/methods/handlers/eth_getTransactionByHash';
import { eth_getTransactionReceipt } from '#rpc/methods/handlers/eth_getTransactionReceipt';
import type { AuthorizedRpcContext } from '#rpc/rpc-service';
import { AuthorizationService } from '#services/authorization-service';
import { EventPermissionVerifier } from '#services/event-permission-verifier';
import { TestExternalRpc } from '#test/rpc/test-external-rpc';
import { it } from '#test/unit-test-context';
import { RpcAuthorizer } from './rpc-authorizer';

const orgContract = pad('0x0c0c', { size: 20 });
const router = pad('0x0d0d', { size: 20 });
const readerWallet = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const outsiderWallet = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const txHash = pad('0xab');
const abi = JSON.stringify(parseAbi(['event Message(bytes32 indexed id)']));
const logger = pino({ level: 'silent' });

// An outsider calls a router that emits one log from the org contract: neither `from` nor `to` is an org address.
const log = { address: orgContract, topics: [pad('0x01')], transactionHash: txHash };
const receipt = { transactionHash: txHash, from: outsiderWallet, to: router, logs: [log], logsBloom: '0x00' };
const transaction = { hash: txHash, from: outsiderWallet, to: router, input: '0x12345678' };

async function seedOrgReader(db: DB, systemPermissions: SystemPermission[], servedReceipt = receipt) {
    const repos = new Repositories(db);
    const org = await repos.organizations.create({ name: 'Owner', defaultRoles: [] });
    const role = await repos.roles.create({ roleName: 'Reader', organizationId: org.id, systemPermissions });
    const user = await repos.users.create({
        displayName: 'Org reader',
        source: 'adminPanel',
        organizationId: org.id,
        roles: [role.id],
        wallets: [readerWallet]
    });
    await repos.contracts.create({
        name: null,
        description: null,
        contractAddress: orgContract,
        organizationId: org.id,
        abi,
        disclosureStartBlock: '0x0'
    });
    return contextFor(repos, user, servedReceipt);
}

function contextFor(repos: Repositories, user: UserWithRoles, servedReceipt: typeof receipt): AuthorizedRpcContext {
    const targetRpc = new TestExternalRpc();
    const auth = new AuthData({ user, targetType: 'user', expiresAt: new Date(), authMethod: 'session' });
    const authorizer = new RpcAuthorizer(
        auth,
        new AuthorizationService({ repos, multiOrgEnabled: true }),
        repos,
        new EventPermissionVerifier(repos, true),
        targetRpc,
        logger,
        'org-log-grant-test'
    );
    targetRpc.registerSend('logs', [log]);
    targetRpc.registerSend('receipt', servedReceipt);
    targetRpc.registerSend('transaction', transaction);
    targetRpc.registerSend('transaction_receipt', servedReceipt);
    return { authorizer, targetRpc, logger, bundlerRpc: null, deployment: null, policyEnabled: false };
}

describe('org-scoped rpc_read_eth_getLogs stays an eth_getLogs grant', () => {
    it('reveals the org contract log but not the receipt or transaction around it', async ({ db }) => {
        const context = await seedOrgReader(db, ['rpc_read_eth_getLogs']);

        expect(await eth_getLogs.handle(context, 'eth_getLogs', [{ address: orgContract }], 'logs')).toMatchObject({
            result: [log]
        });
        expect(
            await eth_getTransactionReceipt.handle(context, 'eth_getTransactionReceipt', [txHash], 'receipt')
        ).toMatchObject({ result: null });
        expect(
            await eth_getTransactionByHash.handle(context, 'eth_getTransactionByHash', [txHash], 'transaction')
        ).toMatchObject({ result: null });
    });

    for (const permission of ['full_read_access', 'full_sequencer_rpc_access'] as const) {
        it(`org-scoped ${permission} still reveals the receipt and transaction around the org contract log`, async ({
            db
        }) => {
            const context = await seedOrgReader(db, [permission]);

            expect(
                await eth_getTransactionReceipt.handle(context, 'eth_getTransactionReceipt', [txHash], 'receipt')
            ).toMatchObject({ result: { transactionHash: txHash, logs: [log] } });
            expect(
                await eth_getTransactionByHash.handle(context, 'eth_getTransactionByHash', [txHash], 'transaction')
            ).toMatchObject({ result: { hash: txHash, input: '0x' } });
        });
    }

    it('the matching receipt grant still reveals a receipt sent to the org contract', async ({ db }) => {
        const context = await seedOrgReader(db, ['rpc_read_eth_getTransactionReceipt'], {
            ...receipt,
            to: orgContract
        });

        expect(
            await eth_getTransactionReceipt.handle(context, 'eth_getTransactionReceipt', [txHash], 'receipt')
        ).toMatchObject({ result: { transactionHash: txHash, logs: [log] } });
    });
});
