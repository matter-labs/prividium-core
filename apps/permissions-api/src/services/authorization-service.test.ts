import { eq } from 'drizzle-orm';
import { type Abi, type Address, encodeFunctionData, getAddress } from 'viem';
import { beforeEach, describe, expect } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { Repositories } from '../db';
import { contractsTable } from '../db/schema';
import type { SystemPermission } from '../permissions/system-permissions';
import { ContractFunctionPermissionsRepository } from '../repositories/contract-function-permissions-repository';
import { ContractsRepository } from '../repositories/contracts-repository';
import { OrganizationsRepository } from '../repositories/organizations-repository';
import { TemplatePermissionsRepository } from '../repositories/template-permissions-repository';
import { TemplatesRepository } from '../repositories/templates-repository';
import { TenantsRepository } from '../repositories/tenants-repository';
import type { User, UserWithRoles } from '../repositories/users-repository';
import { AuthorizationService } from './authorization-service';

const transferAbi: Abi = [
    {
        type: 'function',
        name: 'transfer',
        inputs: [
            { name: 'to', type: 'address' },
            { name: 'amount', type: 'uint256' }
        ],
        outputs: [{ name: '', type: 'bool' }],
        stateMutability: 'nonpayable'
    }
];

const contractAddress = '0x1234567890123456789012345678901234567890' as Address;
const activeWallet = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
const movedWallet = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address;

function fakeUser(walletAddresses: Address[]): User {
    return {
        id: 'user-1',
        displayName: 'Test User',
        oidcSub: null,
        oidcIssuer: null,
        walletToken: null,
        source: 'adminPanel',
        organizationId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        organization: null,
        roles: [],
        wallets: walletAddresses.map((addr, i) => ({
            id: i + 1,
            walletAddress: addr,
            userId: 'user-1',
            createdAt: new Date(),
            updatedAt: new Date()
        }))
    };
}

function fakeUserWithRoles(
    walletAddresses: Address[],
    systemPermissionsByRole: Array<{ roleName: string; systemPermissions: SystemPermission[] }> = []
): UserWithRoles {
    const base = fakeUser(walletAddresses);
    return {
        ...base,
        roles: systemPermissionsByRole.map(({ roleName, systemPermissions }) => ({
            id: `role-${roleName}`,
            roleName,
            systemPermissions,
            isSystemRole: false,
            organizationId: null,
            createdAt: new Date(),
            updatedAt: new Date()
        }))
    };
}

describe('AuthorizationService', () => {
    let authService: AuthorizationService;
    let permissionsRepo: ContractFunctionPermissionsRepository;
    let contractsRepo: ContractsRepository;

    beforeEach<Fixture>(async ({ db }) => {
        authService = new AuthorizationService({ repos: new Repositories(db) });
        permissionsRepo = new ContractFunctionPermissionsRepository(db);
        contractsRepo = new ContractsRepository(db);

        await contractsRepo.create({
            contractAddress,
            abi: JSON.stringify(transferAbi),
            name: 'Test Token',
            description: 'Test',
            discloseErc20TotalSupply: false,
            discloseBytecode: false,
            disclosureStartBlock: '0x0'
        });
    });

    describe('restrictArgument', () => {
        let permissionId: number;

        beforeEach<Fixture>(async () => {
            const permission = await permissionsRepo.create({
                contractAddress,
                functionSignature: 'function transfer(address,uint256)',
                accessType: 'write',
                ruleType: 'restrictArgument',
                argumentRestrictions: [{ argumentIndex: 0 }]
            });
            permissionId = permission.id;
        });

        it('allows when the argument matches the acting wallet', async () => {
            const calldata = encodeFunctionData({
                abi: transferAbi,
                functionName: 'transfer',
                args: [activeWallet, 1n]
            });

            const result = await authService.restrictArgument(permissionId, activeWallet, true, calldata, transferAbi);
            expect(result).toBe('allowed');
        });

        it('denies when the argument does not match the acting wallet', async () => {
            const calldata = encodeFunctionData({
                abi: transferAbi,
                functionName: 'transfer',
                args: [movedWallet, 1n]
            });

            const result = await authService.restrictArgument(permissionId, activeWallet, true, calldata, transferAbi);
            expect(result).toBe('denied');
        });

        it('matches case-insensitively (a checksummed acting address equals a lowercase argument)', async () => {
            const calldata = encodeFunctionData({
                abi: transferAbi,
                functionName: 'transfer',
                args: [activeWallet, 1n]
            });

            const checksummedActing = getAddress(activeWallet);
            const result = await authService.restrictArgument(
                permissionId,
                checksummedActing,
                true,
                calldata,
                transferAbi
            );
            expect(result).toBe('allowed');
        });

        it('reports decode_failed for calldata that does not decode against the ABI', async () => {
            const calldata = encodeFunctionData({
                abi: transferAbi,
                functionName: 'transfer',
                args: [activeWallet, 1n]
            });
            const truncated = calldata.slice(0, 50) as `0x${string}`;

            const result = await authService.restrictArgument(permissionId, activeWallet, true, truncated, transferAbi);
            expect(result).toBe('decode_failed');
        });
    });

    describe('checkMethodAuthorizationForUser — ruleId', () => {
        const calldata = encodeFunctionData({
            abi: transferAbi,
            functionName: 'transfer',
            args: [activeWallet, 1n]
        });

        it('returns wallet.not_owned_by_user when signer wallet is not linked', async () => {
            const user = fakeUser([movedWallet]);
            const result = await authService.checkMethodAuthorizationForUser({
                fromAddress: activeWallet,
                user,
                contractAddress,
                calldata,
                accessTypeCheck: 'write'
            });
            expect(result).toEqual({ authorized: false, ruleId: 'wallet.not_owned_by_user' });
        });

        it('returns permission.missing when no permission row exists for the selector', async () => {
            const user = fakeUser([activeWallet]);
            const result = await authService.checkMethodAuthorizationForUser({
                fromAddress: activeWallet,
                user,
                contractAddress,
                calldata,
                accessTypeCheck: 'write'
            });
            expect(result).toEqual({ authorized: false, ruleId: 'permission.missing' });
        });

        it('returns rule.public.allow for a public rule', async () => {
            await permissionsRepo.create({
                contractAddress,
                functionSignature: 'function transfer(address,uint256)',
                accessType: 'write',
                ruleType: 'public'
            });

            const user = fakeUser([activeWallet]);
            const result = await authService.checkMethodAuthorizationForUser({
                fromAddress: activeWallet,
                user,
                contractAddress,
                calldata,
                accessTypeCheck: 'write'
            });
            expect(result).toEqual({ authorized: true, ruleId: 'rule.public.allow' });
        });

        it('returns permission.access_type_mismatch when requesting write on a read-only permission', async () => {
            await permissionsRepo.create({
                contractAddress,
                functionSignature: 'function transfer(address,uint256)',
                accessType: 'read',
                ruleType: 'public'
            });

            const user = fakeUser([activeWallet]);
            const result = await authService.checkMethodAuthorizationForUser({
                fromAddress: activeWallet,
                user,
                contractAddress,
                calldata,
                accessTypeCheck: 'write'
            });
            expect(result).toEqual({ authorized: false, ruleId: 'permission.access_type_mismatch' });
        });

        it('returns rule.restrict_argument.allow when argument matches the caller wallet', async () => {
            await permissionsRepo.create({
                contractAddress,
                functionSignature: 'function transfer(address,uint256)',
                accessType: 'write',
                ruleType: 'restrictArgument',
                argumentRestrictions: [{ argumentIndex: 0 }]
            });

            const user = fakeUser([activeWallet]);
            const result = await authService.checkMethodAuthorizationForUser({
                fromAddress: activeWallet,
                user,
                contractAddress,
                calldata,
                accessTypeCheck: 'write'
            });
            expect(result).toEqual({ authorized: true, ruleId: 'rule.restrict_argument.allow' });
        });

        it('returns rule.restrict_argument.deny when argument does not match any caller wallet', async () => {
            await permissionsRepo.create({
                contractAddress,
                functionSignature: 'function transfer(address,uint256)',
                accessType: 'write',
                ruleType: 'restrictArgument',
                argumentRestrictions: [{ argumentIndex: 0 }]
            });

            const user = fakeUser([movedWallet]);
            const calldataToDifferent = encodeFunctionData({
                abi: transferAbi,
                functionName: 'transfer',
                args: [activeWallet, 1n]
            });
            const result = await authService.checkMethodAuthorizationForUser({
                fromAddress: movedWallet,
                user,
                contractAddress,
                calldata: calldataToDifferent,
                accessTypeCheck: 'write'
            });
            expect(result).toEqual({ authorized: false, ruleId: 'rule.restrict_argument.deny' });
        });

        it('returns rule.restrict_argument.deny when the argument is another wallet of the same user', async () => {
            await permissionsRepo.create({
                contractAddress,
                functionSignature: 'function transfer(address,uint256)',
                accessType: 'write',
                ruleType: 'restrictArgument',
                argumentRestrictions: [{ argumentIndex: 0 }]
            });

            const user = fakeUser([activeWallet, movedWallet]);
            const calldataToOwnOtherWallet = encodeFunctionData({
                abi: transferAbi,
                functionName: 'transfer',
                args: [movedWallet, 1n]
            });
            const result = await authService.checkMethodAuthorizationForUser({
                fromAddress: activeWallet,
                user,
                contractAddress,
                calldata: calldataToOwnOtherWallet,
                accessTypeCheck: 'write'
            });
            expect(result).toEqual({ authorized: false, ruleId: 'rule.restrict_argument.deny' });
        });

        it('returns rule.restrict_argument.decode_failed when calldata does not decode', async () => {
            await permissionsRepo.create({
                contractAddress,
                functionSignature: 'function transfer(address,uint256)',
                accessType: 'write',
                ruleType: 'restrictArgument',
                argumentRestrictions: [{ argumentIndex: 0 }]
            });

            const user = fakeUser([activeWallet]);
            const truncated = calldata.slice(0, 50) as `0x${string}`;
            const result = await authService.checkMethodAuthorizationForUser({
                fromAddress: activeWallet,
                user,
                contractAddress,
                calldata: truncated,
                accessTypeCheck: 'write'
            });
            expect(result).toEqual({ authorized: false, ruleId: 'rule.restrict_argument.decode_failed' });
        });
    });

    describe('checkMethodAuthorizationForUser — organization scoping', () => {
        const calldata = encodeFunctionData({
            abi: transferAbi,
            functionName: 'transfer',
            args: [activeWallet, 1n]
        });
        const functionSignature = 'function transfer(address,uint256)';

        let orgA: string;
        let orgB: string;
        // Authorization service with the multi-org flag enabled (the outer `authService` has it off).
        let orgAuthService: AuthorizationService;

        beforeEach<Fixture>(async ({ db }) => {
            const repos = new Repositories(db);
            orgAuthService = new AuthorizationService({ repos, multiOrgEnabled: true });
            orgA = (await repos.organizations.create({ name: 'Org A', defaultRoles: [] })).id;
            orgB = (await repos.organizations.create({ name: 'Org B', defaultRoles: [] })).id;
        });

        async function setContractOrg(db: Fixture['db'], organizationId: string | null) {
            await db
                .update(contractsTable)
                .set({ organizationId })
                .where(eq(contractsTable.contractAddress, contractAddress));
        }

        // The loaded relation mirrors what every user query returns; authorization reads its liveness.
        function userInOrg(organizationId: string | null): User {
            return {
                ...fakeUser([activeWallet]),
                organizationId,
                organization: organizationId === null ? null : { id: organizationId, name: 'Org', deletedAt: null }
            };
        }

        function userInDeletedOrg(organizationId: string): User {
            return {
                ...fakeUser([activeWallet]),
                organizationId,
                organization: { id: organizationId, name: 'Deleted Org', deletedAt: new Date() }
            };
        }

        const callTransfer = (service: AuthorizationService, user: User, address: Address = contractAddress) =>
            service.checkMethodAuthorizationForUser({
                fromAddress: activeWallet,
                user,
                contractAddress: address,
                calldata,
                accessTypeCheck: 'write'
            });

        it('allows when the user belongs to the contract organization', async ({ db }) => {
            await setContractOrg(db, orgA);
            await permissionsRepo.create({
                contractAddress,
                functionSignature,
                accessType: 'write',
                ruleType: 'public',
                organizationOnly: true
            });

            expect(await callTransfer(orgAuthService, userInOrg(orgA))).toEqual({
                authorized: true,
                ruleId: 'rule.public.allow'
            });
        });

        it('denies when the user is in a different organization and the function is organization-only', async ({
            db
        }) => {
            await setContractOrg(db, orgA);
            await permissionsRepo.create({
                contractAddress,
                functionSignature,
                accessType: 'write',
                ruleType: 'public',
                organizationOnly: true
            });

            expect(await callTransfer(orgAuthService, userInOrg(orgB))).toEqual({
                authorized: false,
                ruleId: 'permission.org_mismatch'
            });
        });

        it('denies a zone user (no organization) calling an organization-only function', async ({ db }) => {
            await setContractOrg(db, orgA);
            await permissionsRepo.create({
                contractAddress,
                functionSignature,
                accessType: 'write',
                ruleType: 'public',
                organizationOnly: true
            });

            expect(await callTransfer(orgAuthService, userInOrg(null))).toEqual({
                authorized: false,
                ruleId: 'permission.org_mismatch'
            });
        });

        it('applies organization-only scoping by default when the permission does not set it', async ({ db }) => {
            await setContractOrg(db, orgA);
            // No `organizationOnly` on create: the column default (true) governs.
            await permissionsRepo.create({
                contractAddress,
                functionSignature,
                accessType: 'write',
                ruleType: 'public'
            });

            expect(await callTransfer(orgAuthService, userInOrg(orgB))).toEqual({
                authorized: false,
                ruleId: 'permission.org_mismatch'
            });
        });

        it('allows cross-org access when the permission is not organization-only', async ({ db }) => {
            await setContractOrg(db, orgA);
            await permissionsRepo.create({
                contractAddress,
                functionSignature,
                accessType: 'write',
                ruleType: 'public',
                organizationOnly: false
            });

            expect(await callTransfer(orgAuthService, userInOrg(orgB))).toEqual({
                authorized: true,
                ruleId: 'rule.public.allow'
            });
        });

        it('does not scope zone-level contracts (no owner organization)', async () => {
            // The contract created in the outer beforeEach has no organization.
            await permissionsRepo.create({
                contractAddress,
                functionSignature,
                accessType: 'write',
                ruleType: 'public',
                organizationOnly: true
            });

            expect(await callTransfer(orgAuthService, userInOrg(orgB))).toEqual({
                authorized: true,
                ruleId: 'rule.public.allow'
            });
        });

        it('enforces org scoping for template permissions (org lives on the contract)', async ({ db }) => {
            const templatesRepo = new TemplatesRepository(db);
            const templatePermsRepo = new TemplatePermissionsRepository(db);
            const templatedAddress = '0x9999999999999999999999999999999999999999' as Address;

            const template = await templatesRepo.create({
                templateKey: 'org-tmpl',
                name: 'Org Template',
                description: null,
                abi: JSON.stringify(transferAbi)
            });
            await templatePermsRepo.create({
                templateId: template.id,
                functionSignature,
                accessType: 'write',
                ruleType: 'public',
                organizationOnly: true
            });
            // A contract that uses the template (no contract-level permission for the selector),
            // owned by org A.
            await contractsRepo.create({
                contractAddress: templatedAddress,
                abi: JSON.stringify(transferAbi),
                name: 'Templated',
                description: 'Test',
                discloseErc20TotalSupply: false,
                discloseBytecode: false,
                disclosureStartBlock: '0x0',
                templateKey: 'org-tmpl'
            });
            await db
                .update(contractsTable)
                .set({ organizationId: orgA })
                .where(eq(contractsTable.contractAddress, templatedAddress));

            expect(await callTransfer(orgAuthService, userInOrg(orgB), templatedAddress)).toEqual({
                authorized: false,
                ruleId: 'permission.org_mismatch'
            });

            expect(await callTransfer(orgAuthService, userInOrg(orgA), templatedAddress)).toEqual({
                authorized: true,
                ruleId: 'rule.public.allow'
            });
        });

        it('denies a member of a soft-deleted organization on its own organization-only contract', async ({ db }) => {
            await setContractOrg(db, orgA);
            await permissionsRepo.create({
                contractAddress,
                functionSignature,
                accessType: 'write',
                ruleType: 'public',
                organizationOnly: true
            });

            expect(await callTransfer(orgAuthService, userInDeletedOrg(orgA))).toEqual({
                authorized: false,
                ruleId: 'user.organization_deleted'
            });
        });

        it('denies a member of a soft-deleted organization on a zone contract', async ({ db }) => {
            await setContractOrg(db, null);
            await permissionsRepo.create({
                contractAddress,
                functionSignature,
                accessType: 'write',
                ruleType: 'public',
                organizationOnly: false
            });

            expect(await callTransfer(orgAuthService, userInDeletedOrg(orgA))).toEqual({
                authorized: false,
                ruleId: 'user.organization_deleted'
            });
        });

        it('does not enforce org scoping when the multi-org flag is off', async ({ db }) => {
            await setContractOrg(db, orgA);
            await permissionsRepo.create({
                contractAddress,
                functionSignature,
                accessType: 'write',
                ruleType: 'public',
                organizationOnly: true
            });

            // A user in a different organization would be denied with the flag on, but the check
            // is skipped entirely while MULTI_ORG_ENABLED is off.
            expect(await callTransfer(authService, userInOrg(orgB))).toEqual({
                authorized: true,
                ruleId: 'rule.public.allow'
            });
        });

        async function createTenantUserWithWallet(
            db: Fixture['db'],
            wallet: Address,
            organizationId: string | null
        ): Promise<string> {
            const tenantsRepo = new TenantsRepository(db);
            const tenant = await tenantsRepo.create({
                name: 'org-scope-tenant',
                publicKey: '0xcccccccccccccccccccccccccccccccccccccccc',
                defaultRoles: []
            });
            const tenantUser = await tenantsRepo.createUser(tenant.id, {
                displayName: 'Tenant User',
                walletAddresses: [{ walletAddress: wallet }]
            });
            if (organizationId) {
                await new OrganizationsRepository(db).addUser(organizationId, tenantUser.id);
            }
            return tenant.id;
        }

        it('checkForTenant allows when the tenant user belongs to the contract organization', async ({ db }) => {
            await setContractOrg(db, orgA);
            await permissionsRepo.create({
                contractAddress,
                functionSignature,
                accessType: 'write',
                ruleType: 'public',
                organizationOnly: true
            });
            const tenantId = await createTenantUserWithWallet(db, activeWallet, orgA);

            const result = await orgAuthService.checkForTenant(
                tenantId,
                activeWallet,
                contractAddress,
                calldata,
                'write'
            );
            expect(result).toEqual({ authorized: true, ruleId: 'rule.public.allow' });
        });

        it('checkForTenant denies when the tenant user is in a different organization', async ({ db }) => {
            await setContractOrg(db, orgA);
            await permissionsRepo.create({
                contractAddress,
                functionSignature,
                accessType: 'write',
                ruleType: 'public',
                organizationOnly: true
            });
            const tenantId = await createTenantUserWithWallet(db, activeWallet, orgB);

            const result = await orgAuthService.checkForTenant(
                tenantId,
                activeWallet,
                contractAddress,
                calldata,
                'write'
            );
            expect(result).toEqual({ authorized: false, ruleId: 'permission.org_mismatch' });
        });

        it('checkForTenant allows when the contract is a zone contract (no organization)', async ({ db }) => {
            // The contract created in the outer beforeEach has no organization, so the org-only
            // gate is skipped even though the tenant user belongs to a different organization.
            await permissionsRepo.create({
                contractAddress,
                functionSignature,
                accessType: 'write',
                ruleType: 'public',
                organizationOnly: true
            });
            const tenantId = await createTenantUserWithWallet(db, activeWallet, orgB);

            const result = await orgAuthService.checkForTenant(
                tenantId,
                activeWallet,
                contractAddress,
                calldata,
                'write'
            );
            expect(result).toEqual({ authorized: true, ruleId: 'rule.public.allow' });
        });
    });

    describe('checkDeploymentAuthorization', () => {
        it('allows when the caller has a role with contract_deployment', () => {
            const user = fakeUserWithRoles(
                [activeWallet],
                [{ roleName: 'deployer', systemPermissions: ['contract_deployment'] }]
            );
            const result = authService.checkDeploymentAuthorization({ from: activeWallet, user });
            expect(result).toEqual({ authorized: true, ruleId: 'deploy.allow' });
        });

        it('denies with deploy.permission_missing when no role carries contract_deployment', () => {
            const user = fakeUserWithRoles(
                [activeWallet],
                [{ roleName: 'reader', systemPermissions: ['full_read_access'] }]
            );
            const result = authService.checkDeploymentAuthorization({ from: activeWallet, user });
            expect(result).toEqual({ authorized: false, ruleId: 'deploy.permission_missing' });
        });

        it('denies with deploy.address_not_owned when from is not in the user wallet set', () => {
            const user = fakeUserWithRoles(
                [movedWallet],
                [{ roleName: 'deployer', systemPermissions: ['contract_deployment'] }]
            );
            const result = authService.checkDeploymentAuthorization({ from: activeWallet, user });
            expect(result).toEqual({ authorized: false, ruleId: 'deploy.address_not_owned' });
        });

        it('denies with deploy.address_not_owned when from is undefined', () => {
            const user = fakeUserWithRoles(
                [activeWallet],
                [{ roleName: 'deployer', systemPermissions: ['contract_deployment'] }]
            );
            const result = authService.checkDeploymentAuthorization({ from: undefined, user });
            expect(result).toEqual({ authorized: false, ruleId: 'deploy.address_not_owned' });
        });
    });
});
