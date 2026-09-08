import { sql } from 'drizzle-orm';
import type { Repositories, TxType } from '../db';
import type { CreateContractDeployment } from '../repositories/contract-deployments-repository';

export type DeploymentAuditContext = {
    requestId: string | null;
    traceId: string;
    operation: string;
    actorId: string | null;
    actorType: string;
    authSubject: string | null;
    serviceName: string;
    method: string;
    url: string;
    ip: string | null;
    userAgent: string | null;
};

// confirmed: false leaves the row pending for reconciliation / the pending-TTL sweep.
export type DeployOutcome<T> = { result: T; confirmed: boolean };

export interface DeploymentContext {
    recordedDeploy<T>(
        data: CreateContractDeployment,
        deployerUserId: string,
        fn: () => Promise<DeployOutcome<T>>
    ): Promise<T>;
}

/**
 * When a contract deployment happen a series of things have to be updated in the backend.
 * The deployment has to be tracked in the db, and updated accordingly if it's successfully or not.
 * Because the rcp works without audit context the audit context config has to be set for each query.
 */
export class ContractDeploymentContext implements DeploymentContext {
    constructor(
        private readonly repos: Repositories,
        private readonly getAuditContext: () => DeploymentAuditContext
    ) {}

    async recordedDeploy<T>(
        data: CreateContractDeployment,
        deployerUserId: string,
        fn: () => Promise<DeployOutcome<T>>
    ): Promise<T> {
        const audit = this.getAuditContext();

        const deployment = await this.repos.transaction(async (tx) => {
            await this.applyAuditContext(tx, audit);
            return tx.repositories().contractDeployments.create({ ...data, deployedBy: deployerUserId });
        });

        try {
            const { result, confirmed } = await fn();
            if (confirmed) {
                await this.repos.transaction(async (tx) => {
                    await this.applyAuditContext(tx, audit);
                    await tx.repositories().contractDeployments.success(deployment.id);
                });
            }
            return result;
        } catch (e) {
            const msg =
                e && typeof e === 'object' && 'message' in e && typeof e.message === 'string'
                    ? e.message
                    : 'unknown error';
            await this.repos.transaction(async (tx) => {
                await this.applyAuditContext(tx, audit);
                await tx.repositories().contractDeployments.error(deployment.id, msg);
            });
            throw e;
        }
    }

    /**
     * This method is always call in the context of a transaction. It sets the audit context needed for the triggers
     * just for the current running transaction and creates the entry into `audit_request_log` when missing.
     * @param tx
     * @param audit
     * @private
     */
    private async applyAuditContext(tx: TxType, audit: DeploymentAuditContext): Promise<void> {
        await tx.execute(sql`SELECT set_config('app.request_id', ${audit.requestId ?? ''}, true)`);

        if (audit.requestId !== null) {
            await tx.execute(sql`
                INSERT INTO audit_request_log
                    (request_id, trace_id, operation, actor_id, actor_type, auth_subject, service_name, method, url, ip, user_agent)
                VALUES (
                    ${audit.requestId}, ${audit.traceId}, ${audit.operation}, ${audit.actorId}, ${audit.actorType},
                    ${audit.authSubject}, ${audit.serviceName}, ${audit.method}, ${audit.url}, ${audit.ip}, ${audit.userAgent}
                )
                ON CONFLICT (request_id) DO NOTHING
            `);
        }
    }
}
