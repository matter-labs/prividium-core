import type { Address } from 'viem';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestExternalRpc } from '../../test/rpc/test-external-rpc';
import type { Repositories } from '../db';
import type { SystemPermission } from '../permissions/system-permissions';
import type { ContractDeployment } from '../repositories/contract-deployments-repository';
import type { Role } from '../repositories/roles-repository';
import type { User, UserWithRoles } from '../repositories/users-repository';
import { ChainUnavailableError, ForbiddenError, InvalidInputError } from '../utils/error-types';
import {
    assertAddressHasCode,
    assertOrgContractRegisterable,
    CODE_CHECK_TIMEOUT_MS
} from './contract-registration-guard';

const CONTRACT = '0xcccccccccccccccccccccccccccccccccccccccc' as Address;
const CALLER_WALLET = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
const OTHER_WALLET = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address;
const BYTECODE = '0x60806040' as const;

const ORG_A = 'org-a';
const ORG_B = 'org-b';

function role(organizationId: string | null, systemPermissions: SystemPermission[] = ['admin_write']): Role {
    return {
        id: `role-${organizationId ?? 'zone'}`,
        roleName: 'Admin',
        systemPermissions,
        isSystemRole: false,
        organizationId,
        createdAt: new Date(),
        updatedAt: new Date()
    };
}

function caller(roles: Role[], walletAddresses: Address[] = [CALLER_WALLET]): UserWithRoles {
    return {
        id: 'caller',
        displayName: 'caller',
        roles,
        wallets: walletAddresses.map((walletAddress, index) => ({
            id: `wallet-${index}`,
            userId: 'caller',
            walletAddress,
            createdAt: new Date(),
            updatedAt: new Date()
        }))
    } as unknown as UserWithRoles;
}

const orgAdminOfA = caller([role(ORG_A)]);
const zoneOperator = caller([role(null)]);

function rpcWithCodeAt(address?: Address): TestExternalRpc {
    const rpc = new TestExternalRpc();
    if (address) {
        rpc.registerCodeFor(address, BYTECODE);
    }
    return rpc;
}

/** Rejects instead of answering, standing in for a stalled or unreachable sequencer. */
class UnreachableRpc extends TestExternalRpc {
    override isContract(): Promise<boolean> {
        return Promise.reject(new Error('connect ECONNREFUSED'));
    }
}

/** Never answers, standing in for a chain that accepts the connection and then stalls. */
class StalledRpc extends TestExternalRpc {
    override isContract(): Promise<boolean> {
        return new Promise(() => {});
    }
}

/**
 * A recorded deployment. `deployer: null` models the row surviving while the user it points at
 * cannot be resolved, which the guard has to treat as a denial.
 */
type DeploymentStub = {
    deployerAddress: Address;
    deployer: { organizationId: string | null } | null;
};

/** Only the lookups the deployer check reaches for; a null deployment means no record. */
function reposWith(
    deployment: DeploymentStub | null,
    status: 'succeeded' | 'pending' | 'errored' = 'succeeded'
): { repos: Repositories; lookups: string[] } {
    const lookups: string[] = [];
    const row = (address: Address) =>
        ({
            id: 'deployment-1',
            address,
            deployedBy: 'deployer-user',
            deployerAddress: deployment?.deployerAddress
        }) as unknown as ContractDeployment;
    const repos = {
        contractDeployments: {
            findByAddress: (address: Address) => {
                lookups.push(`findByAddress:${address}`);
                return Promise.resolve(deployment === null || status !== 'succeeded' ? undefined : row(address));
            },
            findAllPendingByAddress: (address: Address) => {
                lookups.push(`findAllPendingByAddress:${address}`);
                return Promise.resolve(deployment !== null && status === 'pending' ? [row(address)] : []);
            }
        },
        users: {
            findById: (id: string) => {
                lookups.push(`findById:${id}`);
                const deployer = deployment?.deployer;
                return Promise.resolve(
                    deployer == null ? undefined : ({ id, organizationId: deployer.organizationId } as unknown as User)
                );
            }
        }
    } as unknown as Repositories;
    return { repos, lookups };
}

describe('assertAddressHasCode', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('resolves when the address holds code', async () => {
        await expect(assertAddressHasCode(rpcWithCodeAt(CONTRACT), CONTRACT)).resolves.toBeUndefined();
    });

    it('rejects an address with no code, naming the address', async () => {
        await expect(assertAddressHasCode(rpcWithCodeAt(), CONTRACT)).rejects.toThrowError(
            new InvalidInputError(`No contract is deployed at ${CONTRACT}`)
        );
    });

    it('maps an unreachable chain to a 503 rather than an unmapped 500, keeping the cause', async () => {
        const error = await assertAddressHasCode(new UnreachableRpc(), CONTRACT).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ChainUnavailableError);
        expect((error as ChainUnavailableError).statusCode).toBe(503);
        expect((error as ChainUnavailableError).code).toBe('CHAIN_UNAVAILABLE');
        expect((error as Error).cause).toBeInstanceOf(Error);
    });

    it('maps a stalled chain to 503 once the code check times out', async () => {
        vi.useFakeTimers();
        const pending = assertAddressHasCode(new StalledRpc(), CONTRACT).catch((e: unknown) => e);
        await vi.advanceTimersByTimeAsync(CODE_CHECK_TIMEOUT_MS);
        const error = await pending;

        expect(error).toBeInstanceOf(ChainUnavailableError);
        expect((error as ChainUnavailableError).statusCode).toBe(503);
        expect(((error as Error).cause as Error).message).toContain('timed out');
    });
});

describe('assertOrgContractRegisterable', () => {
    it('rejects a code-less address before consulting any deployment record', async () => {
        const { repos, lookups } = reposWith({ deployerAddress: OTHER_WALLET, deployer: { organizationId: ORG_B } });

        await expect(
            assertOrgContractRegisterable(CONTRACT, {
                chainRpc: rpcWithCodeAt(),
                repos,
                organizationId: ORG_A,
                caller: orgAdminOfA
            })
        ).rejects.toBeInstanceOf(InvalidInputError);
        expect(lookups).toEqual([]);
    });

    it('accepts a foreign org for an address whose deployment row was errored by the TTL sweep', async () => {
        // An errored row matches no authorship query, so the original deployer's claim is
        // gone. The cleanup sweep reconciles mined deploys before erroring to keep this rare.
        const { repos } = reposWith({ deployerAddress: OTHER_WALLET, deployer: { organizationId: ORG_B } }, 'errored');

        await expect(
            assertOrgContractRegisterable(CONTRACT, {
                chainRpc: rpcWithCodeAt(CONTRACT),
                repos,
                organizationId: ORG_A,
                caller: orgAdminOfA
            })
        ).resolves.toBeUndefined();
    });

    it('accepts a deployed address with no deployment record', async () => {
        const { repos } = reposWith(null);

        await expect(
            assertOrgContractRegisterable(CONTRACT, {
                chainRpc: rpcWithCodeAt(CONTRACT),
                repos,
                organizationId: ORG_A,
                caller: orgAdminOfA
            })
        ).resolves.toBeUndefined();
    });

    describe('when a deployment record exists', () => {
        it("rejects an org admin claiming another organization's deployment", async () => {
            const { repos } = reposWith({ deployerAddress: OTHER_WALLET, deployer: { organizationId: ORG_B } });

            await expect(
                assertOrgContractRegisterable(CONTRACT, {
                    chainRpc: rpcWithCodeAt(CONTRACT),
                    repos,
                    organizationId: ORG_A,
                    caller: orgAdminOfA
                })
            ).rejects.toThrowError(new ForbiddenError('This address was deployed by another organization'));
        });

        it('accepts an org admin whose own organization deployed it', async () => {
            const { repos } = reposWith({ deployerAddress: OTHER_WALLET, deployer: { organizationId: ORG_A } });

            await expect(
                assertOrgContractRegisterable(CONTRACT, {
                    chainRpc: rpcWithCodeAt(CONTRACT),
                    repos,
                    organizationId: ORG_A,
                    caller: orgAdminOfA
                })
            ).resolves.toBeUndefined();
        });

        it("accepts a caller who deployed it themselves, whatever the deployer's organization", async () => {
            const { repos } = reposWith({ deployerAddress: CALLER_WALLET, deployer: { organizationId: ORG_B } });

            await expect(
                assertOrgContractRegisterable(CONTRACT, {
                    chainRpc: rpcWithCodeAt(CONTRACT),
                    repos,
                    organizationId: ORG_A,
                    caller: orgAdminOfA
                })
            ).resolves.toBeUndefined();
        });

        // Fails closed. The behaviour falls out of the `deployer !== undefined &&` conjunction
        // rather than being stated, so a refactor could invert it without this test.
        it('rejects an org admin when the recorded deployer cannot be resolved', async () => {
            const { repos, lookups } = reposWith({ deployerAddress: OTHER_WALLET, deployer: null });

            await expect(
                assertOrgContractRegisterable(CONTRACT, {
                    chainRpc: rpcWithCodeAt(CONTRACT),
                    repos,
                    organizationId: ORG_A,
                    caller: orgAdminOfA
                })
            ).rejects.toThrowError(new ForbiddenError('This address was deployed by another organization'));
            expect(lookups).toEqual([`findByAddress:${CONTRACT}`, 'findById:deployer-user']);
        });

        // The operator curates the callable surface and can already assign a contract to any
        // organization, so the match would only make them route around it.
        it('exempts a zone operator, without reading the deployment record at all', async () => {
            const { repos, lookups } = reposWith({
                deployerAddress: OTHER_WALLET,
                deployer: { organizationId: ORG_B }
            });

            await expect(
                assertOrgContractRegisterable(CONTRACT, {
                    chainRpc: rpcWithCodeAt(CONTRACT),
                    repos,
                    organizationId: ORG_A,
                    caller: zoneOperator
                })
            ).resolves.toBeUndefined();
            expect(lookups).toEqual([]);
        });

        it('still requires code from a zone operator', async () => {
            const { repos } = reposWith(null);

            await expect(
                assertOrgContractRegisterable(CONTRACT, {
                    chainRpc: rpcWithCodeAt(),
                    repos,
                    organizationId: ORG_A,
                    caller: zoneOperator
                })
            ).rejects.toBeInstanceOf(InvalidInputError);
        });

        // An org-scoped `admin_write` is what `requireOrgAdmin` accepts, so the exemption must key
        // on the role being zone-level rather than on holding the permission.
        it('rejects an org admin when only a pending deployment names another organization', async () => {
            // A sync deploy that hit an EIP-7966 timeout stays pending while its tx may still mine, so
            // the code is on-chain with no success recorded. Reading only successful rows fails open here.
            const { repos, lookups } = reposWith(
                { deployerAddress: OTHER_WALLET, deployer: { organizationId: ORG_B } },
                'pending'
            );
            await expect(
                assertOrgContractRegisterable(CONTRACT, {
                    chainRpc: rpcWithCodeAt(CONTRACT),
                    repos,
                    organizationId: ORG_A,
                    caller: orgAdminOfA
                })
            ).rejects.toBeInstanceOf(ForbiddenError);
            expect(lookups).toContain(`findAllPendingByAddress:${CONTRACT}`);
        });

        it('allows an org admin when a pending deployment belongs to their own organization', async () => {
            const { repos } = reposWith(
                { deployerAddress: OTHER_WALLET, deployer: { organizationId: ORG_A } },
                'pending'
            );
            await expect(
                assertOrgContractRegisterable(CONTRACT, {
                    chainRpc: rpcWithCodeAt(CONTRACT),
                    repos,
                    organizationId: ORG_A,
                    caller: orgAdminOfA
                })
            ).resolves.toBeUndefined();
        });

        it('does not exempt an org admin who holds admin_write scoped to their own org', async () => {
            const { repos } = reposWith({ deployerAddress: OTHER_WALLET, deployer: { organizationId: ORG_B } });

            await expect(
                assertOrgContractRegisterable(CONTRACT, {
                    chainRpc: rpcWithCodeAt(CONTRACT),
                    repos,
                    organizationId: ORG_A,
                    caller: caller([role(ORG_A, ['admin_read', 'admin_write'])])
                })
            ).rejects.toBeInstanceOf(ForbiddenError);
        });
    });
});
