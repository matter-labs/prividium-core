import type { Address, Hex } from 'viem';
import { beforeEach, describe, expect } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { type DB, Repositories } from '../db';
import { UserSources } from '../db/schema';
import { ContractDeploymentContext, type DeploymentAuditContext } from './contract-deployment-context';

const DEPLOYER = '0x1234567890123456789012345678901234567890' as Address;
const CONTRACT = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as Address;
const TX_HASH = '0x1111111111111111111111111111111111111111111111111111111111111111' as Hex;
const REQUEST_ID = 'deploy-ctx-test-request';

const AUDIT: DeploymentAuditContext = {
    requestId: REQUEST_ID,
    traceId: 'trace-1',
    operation: 'eth_sendRawTransaction',
    actorId: null,
    actorType: 'user',
    authSubject: null,
    serviceName: 'permissions-api',
    method: 'POST',
    url: '/rpc',
    ip: null,
    userAgent: null
};

describe('ContractDeploymentContext.recordedDeploy', () => {
    let database: DB;
    let repos: Repositories;
    let context: ContractDeploymentContext;
    let userId: string;

    beforeEach<Fixture>(async ({ db }) => {
        database = db;
        repos = new Repositories(db);
        context = new ContractDeploymentContext(repos, () => AUDIT);
        const user = await repos.users.create({
            oidcSub: 'deployer-user',
            displayName: 'Deployer User',
            wallets: [DEPLOYER],
            source: UserSources.enum.adminPanel
        });
        userId = user.id;
    });

    const DEPLOY_DATA = {
        address: CONTRACT,
        deployerAddress: DEPLOYER,
        deployerNonce: 1,
        deployTxHash: TX_HASH,
        startedAt: new Date()
    };

    function deploymentUpdateAudits() {
        return database.query.dbMutationAuditLogsTable.findMany({
            where: (t, { and, eq }) =>
                and(eq(t.tableName, 'contract_deployments'), eq(t.operation, 'UPDATE'), eq(t.requestId, REQUEST_ID))
        });
    }

    it('confirmed: false leaves the row pending and writes no success mutation audit', async () => {
        const result = await context.recordedDeploy(DEPLOY_DATA, userId, async () => ({
            result: 'ok',
            confirmed: false
        }));

        expect(result).toBe('ok');
        const [row] = await repos.contractDeployments.findAllPendingByAddress(CONTRACT);
        expect(row).toBeDefined();
        expect(row?.successAt).toBeNull();
        expect(row?.erroredAt).toBeNull();
        expect(await deploymentUpdateAudits()).toEqual([]);
    });

    it('confirmed: true marks success and applies the audit context inside the success transaction', async () => {
        await context.recordedDeploy(DEPLOY_DATA, userId, async () => ({ result: 'ok', confirmed: true }));

        const row = await repos.contractDeployments.findByAddress(CONTRACT);
        expect(row?.successAt).not.toBeNull();
        const updates = await deploymentUpdateAudits();
        expect(updates).toHaveLength(1);
        expect(updates[0]?.requestId).toBe(REQUEST_ID);
    });
});
