import type { Address } from 'viem';
import { describe, expect, it } from 'vitest';
import type { Repositories } from '../../db';
import { AuthData } from '../../middleware/auth-data';
import type { SystemPermission } from '../../permissions/system-permissions';
import type { M2mApplication } from '../../repositories/m2m-applications-repository';
import type { Role } from '../../repositories/roles-repository';
import type { UserWithRoles } from '../../repositories/users-repository';
import type { MethodAuthorizer } from '../../services/authorization-service';
import type { EventPermissionVerifier } from '../../services/event-permission-verifier';
import type { PinoLogger } from '../../utils/logger';
import { UnauthorizedRpcError } from '../errors';
import type { ExternalRpc } from '../target-rpc';
import { RpcAuthorizer } from './rpc-authorizer';

const deployerAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
const strangerAddress = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address;

function role(roleName: string, systemPermissions: SystemPermission[], organizationId: string | null = null): Role {
    return {
        id: `role-${roleName}`,
        roleName,
        systemPermissions,
        isSystemRole: false,
        organizationId,
        createdAt: new Date(),
        updatedAt: new Date()
    };
}

function user(id: string, roles: Role[], walletAddresses: Address[] = [deployerAddress]): UserWithRoles {
    return {
        id,
        displayName: id,
        oidcSub: null,
        oidcIssuer: null,
        walletToken: null,
        source: 'oidc',
        organizationId: 'org-1',
        organization: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        roles,
        wallets: walletAddresses.map((walletAddress, index) => ({
            id: `wallet-${index}`,
            userId: id,
            walletAddress,
            createdAt: new Date(),
            updatedAt: new Date()
        }))
    } as unknown as UserWithRoles;
}

function m2mApp(roles: Role[]): M2mApplication {
    return {
        id: 'm2m-1',
        name: 'fireblocks-ci',
        description: null,
        ownerOrganizationId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        roles,
        organizations: [{ id: 'org-1' }],
        hasOverbroadIpWhitelist: false
    };
}

/** Only the lookup `authorizeDeployment` reaches for; everything else stays unreachable. */
function reposWith(resolved: UserWithRoles | undefined): Repositories {
    return {
        m2mApps: {
            findUserWithRolesByAddressForApp: (_appId: string, address: Address) =>
                Promise.resolve(address === deployerAddress ? resolved : undefined)
        }
    } as unknown as Repositories;
}

function authorizerFor(auth: AuthData, repos: Repositories): RpcAuthorizer {
    return new RpcAuthorizer(
        auth,
        {} as MethodAuthorizer,
        repos,
        {} as EventPermissionVerifier,
        {} as ExternalRpc,
        {} as PinoLogger,
        'test-request-id'
    );
}

function userAuth(u: UserWithRoles): AuthData {
    return new AuthData({ user: u, targetType: 'user', expiresAt: new Date(), authMethod: 'session' });
}

function m2mAuth(app: M2mApplication): AuthData {
    return new AuthData({ m2mApp: app, targetType: 'm2m_app', expiresAt: new Date(), authMethod: 'api_key' });
}

describe('RpcAuthorizer.authorizeDeployment', () => {
    describe('user session', () => {
        it('allows a wallet owner whose role carries contract_deployment', async () => {
            const deployer = user('user-1', [role('deployer', ['contract_deployment'])]);
            const authorizer = authorizerFor(userAuth(deployer), reposWith(undefined));

            await expect(authorizer.authorizeDeployment(deployerAddress)).resolves.toEqual({
                authorized: true,
                ruleId: 'deploy.allow',
                deployerUserId: 'user-1'
            });
        });

        it('denies with deploy.address_not_owned when the signer is not one of the user wallets', async () => {
            const deployer = user('user-1', [role('deployer', ['contract_deployment'])]);
            const authorizer = authorizerFor(userAuth(deployer), reposWith(undefined));

            await expect(authorizer.authorizeDeployment(strangerAddress)).resolves.toEqual({
                authorized: false,
                ruleId: 'deploy.address_not_owned'
            });
        });

        it('denies with deploy.permission_missing when no role carries contract_deployment', async () => {
            const deployer = user('user-1', [role('reader', ['org_rpc_access'])]);
            const authorizer = authorizerFor(userAuth(deployer), reposWith(undefined));

            await expect(authorizer.authorizeDeployment(deployerAddress)).resolves.toEqual({
                authorized: false,
                ruleId: 'deploy.permission_missing'
            });
        });
    });

    describe('m2m app', () => {
        const appRoles = [role('ci', ['org_rpc_access', 'contract_deployment'])];

        it('allows and records the deployment against the resolved org user', async () => {
            const deployer = user('user-1', [role('deployer', ['contract_deployment'])]);
            const authorizer = authorizerFor(m2mAuth(m2mApp(appRoles)), reposWith(deployer));

            await expect(authorizer.authorizeDeployment(deployerAddress)).resolves.toEqual({
                authorized: true,
                ruleId: 'deploy.allow',
                deployerUserId: 'user-1'
            });
        });

        it('denies with m2m.rpc_access_missing when the credential lacks org_rpc_access', async () => {
            const deployer = user('user-1', [role('deployer', ['contract_deployment'])]);
            const app = m2mApp([role('ci', ['contract_deployment'])]);

            await expect(
                authorizerFor(m2mAuth(app), reposWith(deployer)).authorizeDeployment(deployerAddress)
            ).resolves.toEqual({ authorized: false, ruleId: 'm2m.rpc_access_missing' });
        });

        it('denies with deploy.permission_missing when the credential lacks contract_deployment', async () => {
            const deployer = user('user-1', [role('deployer', ['contract_deployment'])]);
            const app = m2mApp([role('ci', ['org_rpc_access'])]);

            await expect(
                authorizerFor(m2mAuth(app), reposWith(deployer)).authorizeDeployment(deployerAddress)
            ).resolves.toEqual({ authorized: false, ruleId: 'deploy.permission_missing' });
        });

        it('denies with m2m.user_not_found when the signer belongs to no user in a linked org', async () => {
            const authorizer = authorizerFor(m2mAuth(m2mApp(appRoles)), reposWith(undefined));

            await expect(authorizer.authorizeDeployment(deployerAddress)).resolves.toEqual({
                authorized: false,
                ruleId: 'm2m.user_not_found'
            });
        });

        it('denies with deploy.permission_missing when the resolved user lacks contract_deployment', async () => {
            const deployer = user('user-1', [role('reader', ['org_rpc_access'])]);
            const authorizer = authorizerFor(m2mAuth(m2mApp(appRoles)), reposWith(deployer));

            await expect(authorizer.authorizeDeployment(deployerAddress)).resolves.toEqual({
                authorized: false,
                ruleId: 'deploy.permission_missing'
            });
        });

        it('does not fall back to credential-level access when the signer is unknown', async () => {
            const deployer = user('user-1', [role('deployer', ['contract_deployment'])]);
            const app = m2mApp([role('ci', ['org_rpc_access', 'full_sequencer_rpc_access'])]);

            await expect(
                authorizerFor(m2mAuth(app), reposWith(deployer)).authorizeDeployment(strangerAddress)
            ).resolves.toEqual({ authorized: false, ruleId: 'm2m.user_not_found' });
        });
    });

    describe('other auth types', () => {
        // A denial, not a throw: only ForbiddenRpcError reaches the denial ledger, and the SDK reads
        // the unauthorized code as an expired session and re-logs-in.
        it('denies a tenant credential without raising an auth error', async () => {
            const auth = new AuthData({
                tenant: { id: 'tenant-1', defaultRoles: [], roles: [] } as never,
                targetType: 'tenant',
                expiresAt: new Date(),
                authMethod: 'api_key'
            });

            await expect(
                authorizerFor(auth, reposWith(undefined)).authorizeDeployment(deployerAddress)
            ).resolves.toEqual({ authorized: false, ruleId: 'deploy.permission_missing' });
        });

        it('raises an auth error for an anonymous caller', async () => {
            const auth = new AuthData({ targetType: 'anonymous', expiresAt: new Date(), authMethod: 'session' });

            await expect(
                authorizerFor(auth, reposWith(undefined)).authorizeDeployment(deployerAddress)
            ).rejects.toBeInstanceOf(UnauthorizedRpcError);
        });
    });
});
