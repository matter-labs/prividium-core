import type { Address, Hex } from 'viem';
import type { MethodAccessType } from '../../db/schema';
import type { SystemPermission } from '../../permissions/system-permissions';
import type { AuthorizationResult } from '../../services/authorization-service';
import type { AddressSet } from '../address-set';
import type { GetLogsFilter } from '../methods/handlers';

export type LogData = { address: Hex; topics: Hex[] };

/**
 * Returned by the three selective-disclosure auth checks. `null` means the
 * caller is not authorized; an object means authorized and carries the floor
 * block below which disclosure is forbidden.
 */
export type DisclosureConfig = { disclosureStartBlock: Hex };

/** Deploy decision plus the user it is recorded against, so the recording site never re-resolves the signer. */
export type DeploymentAuthorization = AuthorizationResult & { deployerUserId?: string };

export interface Authorizer {
    /**
     * Returns the full result, not a bare boolean, so deny sites can attach a ruleId for the denial ledger.
     */
    checkContractAccess(
        from: Address | undefined,
        to: Address,
        callData: Hex,
        access: MethodAccessType,
        rpcMethod: string
    ): Promise<AuthorizationResult>;

    checkStorageRead(contract: Address, slot: Hex): Promise<boolean>;

    checkAddressOwnership(address: Address): Promise<boolean>;

    getTokenSupplyDisclosureConfig(address: Address): Promise<DisclosureConfig | null>;

    getTokenBalanceDisclosureConfig(tokenAddress: Address, holderAddress: Address): Promise<DisclosureConfig | null>;

    getBytecodeDisclosureConfig(address: Address): Promise<DisclosureConfig | null>;

    ensureUserExists(): Promise<void>;

    associatedAddresses(): Promise<AddressSet>;

    assertCanFilterTransactions(): Promise<void>;
    visibleAddressesAmong(candidates: Address[]): Promise<AddressSet>;

    hasFullSequencerAccess(): Promise<boolean>;

    hasDeploymentPermission(): Promise<boolean>;

    authorizeDeployment(from: Address): Promise<DeploymentAuthorization>;

    hasFullReadAccess(): Promise<boolean>;

    hasRpcMethodPermission(method: string): Promise<boolean>;

    checkBatchEventRead<T extends LogData>(logData: T[]): Promise<T[]>;

    checkContractAuthorship(address: Hex): Promise<boolean>;

    couldQueryMatchPermissions(filter: GetLogsFilter): Promise<boolean>;

    hasOrgVisibilityOver(
        toAddress: Address,
        includeUsers?: boolean,
        extraPermissions?: SystemPermission[]
    ): Promise<boolean>;
}
