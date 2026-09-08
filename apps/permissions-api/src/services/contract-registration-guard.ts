import { hasZoneSystemPermission } from '@repo/access-control';
import type { Address } from 'viem';
import type { Repositories } from '../db';
import type { UserWithRoles } from '../repositories/users-repository';
import type { ExternalRpc } from '../rpc/target-rpc';
import { ChainUnavailableError, ForbiddenError, InvalidInputError } from '../utils/error-types';
import { hexListIncludes } from '../utils/hex';

export const CODE_CHECK_TIMEOUT_MS = 5_000;

/**
 * Registration grants RPC access, so the address must really hold code. It also blocks
 * claiming an address before its owner deploys there.
 */
export async function assertAddressHasCode(chainRpc: ExternalRpc, address: Address): Promise<void> {
    let deployed: boolean;
    try {
        // TargetRpc.send has no abort plumbing, so bound the wait here: a stalled chain
        // gets the caller the 503 instead of hanging the admin request.
        deployed = await raceTimeout(chainRpc.isContract(address), CODE_CHECK_TIMEOUT_MS);
    } catch (err) {
        throw new ChainUnavailableError('Cannot reach the chain to verify the contract address', { cause: err });
    }
    if (!deployed) {
        // The 400 here vs the 403 from the deployer check is a deliberate split: the 403 alone
        // already reveals a foreign deploy, so collapsing them would not hide anything.
        throw new InvalidInputError(`No contract is deployed at ${address}`);
    }
}

async function raceTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`eth_getCode timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    try {
        return await Promise.race([work, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

export type OrgRegistrationCheck = {
    chainRpc: ExternalRpc;
    repos: Repositories;
    organizationId: string;
    caller: UserWithRoles;
};

/**
 * Guard for the org routes (org admin or zone operator). Operators skip the deployer
 * match: they can already assign any contract to any organization.
 */
export async function assertOrgContractRegisterable(
    address: Address,
    { chainRpc, repos, organizationId, caller }: OrgRegistrationCheck
): Promise<void> {
    await assertAddressHasCode(chainRpc, address);
    if (hasZoneSystemPermission(caller, 'admin_write')) {
        return;
    }
    await assertDeployerAllowed(repos, address, {
        organizationId,
        callerWallets: caller.wallets.map((w) => w.walletAddress)
    });
}

// A missing record is normal (factory, CREATE2, pre-existing contract), so it cannot be required.
// Pending rows count as claims: a timed-out sync deploy may still mine, so skipping pending rows
// would let another org claim the address in that window.
async function assertDeployerAllowed(
    repos: Repositories,
    address: Address,
    { organizationId, callerWallets }: { organizationId: string; callerWallets: Address[] }
): Promise<void> {
    const claims = await repos.contractDeployments
        .findByAddress(address)
        .then(async (succeeded) =>
            succeeded !== undefined ? [succeeded] : repos.contractDeployments.findAllPendingByAddress(address)
        );
    if (claims.length === 0) {
        return;
    }
    if (claims.some((claim) => hexListIncludes(callerWallets, claim.deployerAddress))) {
        return;
    }

    for (const claim of claims) {
        const deployer = await repos.users.findById(claim.deployedBy);
        if (deployer !== undefined && deployer.organizationId === organizationId) {
            return;
        }
    }

    throw new ForbiddenError('This address was deployed by another organization');
}
