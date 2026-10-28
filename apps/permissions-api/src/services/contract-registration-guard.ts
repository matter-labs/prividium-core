import { hasZoneSystemPermission } from '@repo/access-control';
import { type ChainAddress, type ChainNode, chainAddressListIncludes } from '@repo/api-kit';
import type { Repositories } from '../db';
import type { UserWithRoles } from '../repositories/users-repository';
import { ChainUnavailableError, ForbiddenError, InvalidInputError } from '../utils/error-types';
import { isReservedContractAddress } from '../utils/reserved-contract-address';

export const CODE_CHECK_TIMEOUT_MS = 5_000;

const OWNERSHIP_UNVERIFIED =
    "Cannot verify this organization's ownership; ask a zone operator to review the registration.";

/**
 * Registration grants RPC access, so the address must really hold a contract. It also blocks
 * claiming an address before its owner deploys there.
 */
export async function assertContractDeployed(
    chain: Pick<ChainNode, 'contractExists'>,
    address: ChainAddress
): Promise<void> {
    let deployed: boolean;
    try {
        // The chain clients have no abort plumbing, so bound the wait here: a stalled chain
        // gets the caller the 503 instead of hanging the admin request.
        deployed = await raceTimeout(chain.contractExists(address), CODE_CHECK_TIMEOUT_MS);
    } catch (err) {
        throw new ChainUnavailableError('Cannot reach the chain to verify the contract address', { cause: err });
    }
    if (!deployed) {
        throw new InvalidInputError(`No contract is deployed at ${address}`);
    }
}

async function raceTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Contract check timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    try {
        return await Promise.race([work, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

export type OrgRegistrationCheck = {
    chain: Pick<ChainNode, 'contractExists'>;
    repos: Repositories;
    organizationId: string;
    caller: UserWithRoles;
};

export function assertOrgContractAddress(address: ChainAddress): void {
    if (isReservedContractAddress(address)) {
        throw new InvalidInputError('Cannot register a reserved contract address to an organization');
    }
}

/**
 * Guard for the org routes (org admin or zone operator). Operators skip the deployer
 * match: they can already assign any contract to any organization.
 */
export async function assertOrgContractRegisterable(
    address: ChainAddress,
    { chain, repos, organizationId, caller }: OrgRegistrationCheck
): Promise<void> {
    assertOrgContractAddress(address);
    await assertContractDeployed(chain, address);
    if (hasZoneSystemPermission(caller, 'admin_write')) {
        return;
    }
    await assertDeployerAllowed(repos, address, {
        organizationId,
        callerWallets: caller.wallets.map((w) => w.walletAddress)
    });
}

// Pending rows count as claims: a timed-out sync deploy may still mine, so skipping pending rows
// would let another org claim the address in that window.
async function assertDeployerAllowed(
    repos: Repositories,
    address: ChainAddress,
    { organizationId, callerWallets }: { organizationId: string; callerWallets: ChainAddress[] }
): Promise<void> {
    const claims = await repos.contractDeployments
        .findByAddress(address)
        .then(async (succeeded) =>
            succeeded !== undefined ? [succeeded] : repos.contractDeployments.findAllPendingByAddress(address)
        );
    if (claims.length === 0) {
        throw new ForbiddenError(OWNERSHIP_UNVERIFIED);
    }
    if (claims.some((claim) => chainAddressListIncludes(callerWallets, claim.deployerAddress))) {
        return;
    }

    for (const claim of claims) {
        const deployer = await repos.users.findById(claim.deployedBy);
        if (deployer !== undefined && deployer.organizationId === organizationId) {
            return;
        }
    }

    throw new ForbiddenError(OWNERSHIP_UNVERIFIED);
}
