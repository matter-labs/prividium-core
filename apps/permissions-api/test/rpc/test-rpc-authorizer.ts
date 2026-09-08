// Mock authorizer that allows everything by default
import type { Address, Hex } from 'viem';
import type { MethodAccessType } from '../../src/db/schema';
import { AddressSet } from '../../src/rpc/address-set';
import type { GetLogsFilter } from '../../src/rpc/methods/handlers/eth_getLogs';
import type { Authorizer, DeploymentAuthorization, DisclosureConfig, LogData } from '../../src/rpc/permissions';
import type { AuthorizationResult } from '../../src/services/authorization-service';

const ALLOW_FROM_GENESIS: DisclosureConfig = { disclosureStartBlock: '0x0' };

export class TestRpcAuthorizer implements Authorizer {
    allowRead = true; // Made public for easier testing
    bytecodeDisclosureConfig: DisclosureConfig | null = ALLOW_FROM_GENESIS;
    balanceDisclosureConfig: DisclosureConfig | null = ALLOW_FROM_GENESIS;
    supplyDisclosureConfig: DisclosureConfig | null = ALLOW_FROM_GENESIS;
    addresses: Address[] = [];
    eventAllowMask: boolean[] = [];
    fullReadAccess = false;
    fullSequencerAccess = false;
    couldQueryMatchResult = true;
    rpcReadPermissions = new Set<string>();
    allowDeployment = false;
    deployerUserId = 'test-deployer-user';

    setAllowRead(allow: boolean) {
        this.allowRead = allow;
    }

    setLogPermission(allowMask: boolean[]) {
        this.eventAllowMask = allowMask;
    }

    setFullReadAccess(value: boolean) {
        this.fullReadAccess = value;
    }

    checkContractAccess(
        _from: Address | undefined,
        _to: Address,
        _callData: Hex,
        _access: MethodAccessType
    ): Promise<AuthorizationResult> {
        return Promise.resolve(
            this.allowRead ? { authorized: true } : { authorized: false, ruleId: 'permission.missing' }
        );
    }

    checkStorageRead(_address: string, _slot: string): Promise<boolean> {
        return Promise.resolve(this.allowRead);
    }

    checkAddressOwnership(_address: Address): Promise<boolean> {
        return Promise.resolve(false);
    }

    getTokenSupplyDisclosureConfig(_address: Address): Promise<DisclosureConfig | null> {
        return Promise.resolve(this.supplyDisclosureConfig);
    }

    getTokenBalanceDisclosureConfig(_tokenAddress: Address, _holderAddress: Address): Promise<DisclosureConfig | null> {
        return Promise.resolve(this.balanceDisclosureConfig);
    }

    getBytecodeDisclosureConfig(_address: Address): Promise<DisclosureConfig | null> {
        return Promise.resolve(this.bytecodeDisclosureConfig);
    }

    setBytecodeDisclosureConfig(config: DisclosureConfig | null) {
        this.bytecodeDisclosureConfig = config;
    }

    setSupplyDisclosureConfig(config: DisclosureConfig | null) {
        this.supplyDisclosureConfig = config;
    }

    setBalanceDisclosureConfig(config: DisclosureConfig | null) {
        this.balanceDisclosureConfig = config;
    }

    setUserAddresses(addresses: Address[]) {
        this.addresses = addresses;
    }

    async ensureUserExists(): Promise<void> {
        // no-op
    }

    associatedAddresses(): Promise<AddressSet> {
        return Promise.resolve(new AddressSet(this.addresses));
    }

    assertCanFilterTransactions(): Promise<void> {
        return Promise.resolve();
    }

    visibleAddressesAmong(candidates: Address[]): Promise<AddressSet> {
        const visible = new AddressSet(this.addresses);
        return Promise.resolve(new AddressSet(candidates.filter((candidate) => visible.has(candidate))));
    }

    hasDeploymentPermission(): Promise<boolean> {
        return Promise.resolve(this.allowDeployment);
    }

    setAllowDeployment(value: boolean) {
        this.allowDeployment = value;
    }

    authorizeDeployment(_from: Address): Promise<DeploymentAuthorization> {
        return Promise.resolve(
            this.allowDeployment
                ? { authorized: true, ruleId: 'deploy.allow', deployerUserId: this.deployerUserId }
                : { authorized: false, ruleId: 'deploy.permission_missing' }
        );
    }

    setFullSequencerAccess(value: boolean) {
        this.fullSequencerAccess = value;
    }

    hasFullSequencerAccess(): Promise<boolean> {
        return Promise.resolve(this.fullSequencerAccess);
    }

    hasFullReadAccess(): Promise<boolean> {
        return Promise.resolve(this.fullReadAccess);
    }

    setRpcReadPermissions(methods: string[]) {
        this.rpcReadPermissions = new Set(methods);
    }

    hasRpcMethodPermission(method: string): Promise<boolean> {
        return Promise.resolve(this.rpcReadPermissions.has(method));
    }

    checkBatchEventRead<T extends LogData>(logData: T[]): Promise<T[]> {
        return Promise.resolve(logData.filter((_e, i) => this.eventAllowMask[i]));
    }

    checkContractAuthorship(_address: Hex): Promise<boolean> {
        return Promise.resolve(false);
    }

    setCouldQueryMatch(value: boolean) {
        this.couldQueryMatchResult = value;
    }

    couldQueryMatchPermissions(_filter: GetLogsFilter): Promise<boolean> {
        return Promise.resolve(this.couldQueryMatchResult);
    }

    hasOrgVisibilityOver(_toAddress: Address): Promise<boolean> {
        return Promise.resolve(false);
    }
}
