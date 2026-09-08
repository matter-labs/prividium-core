import { type Address, type Hex, keccak256, parseTransaction, type TransactionSerialized } from 'viem';
import type { Repositories } from '../../db';
import { prividiumPermix } from '../../permissions/prividium-permix';
import type { UserWithRoles } from '../../repositories/users-repository';
import type { AuthorizationResult, MethodAuthorizer } from '../../services/authorization-service';
import type { TransactionClassifier } from '../../services/transaction-classifier';
import { EntityNotFound } from '../../utils/error-types';
import { areHexEqual } from '../../utils/hex';
import { recoverTransactionAddressNative } from '../../utils/recover-tx-address-native';
import { userHasWallet } from '../../utils/user-wallets';

export class WalletAuthorizer {
    private user: UserWithRoles;
    private repos: Repositories;
    private methodAuthService: MethodAuthorizer;
    private transactionClassifier: TransactionClassifier;
    private requestId: string | undefined;

    constructor(
        user: UserWithRoles,
        repos: Repositories,
        methodAuthService: MethodAuthorizer,
        transactionClassifier: TransactionClassifier,
        requestId?: string
    ) {
        this.user = user;
        this.repos = repos;
        this.methodAuthService = methodAuthService;
        this.transactionClassifier = transactionClassifier;
        this.requestId = requestId;
    }

    get userId(): string {
        return this.user.id;
    }

    private addressesAreEqual(addr1: Address | null, addr2: Address | null): boolean {
        if (addr1 === null) {
            return addr2 === null;
        }

        if (addr2 === null) {
            return false;
        }

        return areHexEqual(addr1, addr2);
    }

    /**
     * Full result (see `Authorizer.checkContractAccess`). Deny causes carry a `reason`/`ruleId` for the ledger.
     */
    async checkTransactionAllowed(
        from: Address,
        to: Address | null,
        nonce: number,
        calldata: Hex,
        value: bigint,
        rpcMethod?: string
    ): Promise<AuthorizationResult> {
        const classification = await this.transactionClassifier.classifyTransaction(to, calldata, value);

        if (classification.type === 'empty') {
            return { authorized: false, reason: 'transaction classified as empty' };
        }

        const allowance = await this.repos.walletTransactionAllowances.findByUserAndWalletAndNonce(
            this.user.id,
            from,
            nonce
        );

        if (allowance === undefined) {
            return { authorized: false, reason: 'no transaction allowance for this wallet and nonce' };
        }

        if (!areHexEqual(allowance.transactionCalldata, calldata)) {
            return { authorized: false, reason: 'transaction calldata does not match the allowance' };
        }

        if (!this.addressesAreEqual(allowance.toAddress, to)) {
            return { authorized: false, reason: 'transaction target does not match the allowance' };
        }

        if (allowance.transactionValue !== value) {
            return { authorized: false, reason: 'transaction value does not match the allowance' };
        }

        if (classification.type === 'transfer-to-eoa') {
            return { authorized: true };
        }

        if (classification.type === 'contract-call' || classification.type === 'transfer-to-contract') {
            return this.methodAuthService.checkMethodAuthorizationForUser({
                fromAddress: from,
                user: this.user,
                accessTypeCheck: 'write',
                calldata,
                contractAddress: classification.toAddress,
                rpcMethod,
                requestId: this.requestId
            });
        }

        if (classification.type === 'deployment') {
            const canDeploy = await prividiumPermix(this.user).check('sequencer', 'deployment');
            return canDeploy
                ? { authorized: true, ruleId: 'deploy.allow' }
                : { authorized: false, ruleId: 'deploy.permission_missing' };
        }

        // Unreachable
        throw new Error(`Unknown transaction type: ${classification.type}`);
    }

    async updateTransactionHash(rawTx: Hex): Promise<void> {
        const tx = parseTransaction(rawTx);
        const from = await recoverTransactionAddressNative({
            serializedTransaction: rawTx as TransactionSerialized
        });
        const transactionHash = keccak256(rawTx);

        await this.repos.walletTransactionAllowances.updateTransactionHash(
            this.user.id,
            from,
            tx.nonce!,
            tx.data || '0x',
            transactionHash,
            tx.value ?? 0n
        );
    }

    async getTxHash(): Promise<Hex | null> {
        const allowance = await this.repos.walletTransactionAllowances.latestForUser(this.user.id);

        if (!allowance) {
            throw new EntityNotFound('Allowance not found', { user: this.user.id });
        }
        const txHash = allowance.transactionHash;

        if (txHash === null) {
            return null;
        }

        return txHash;
    }

    async canCheckBalanceOf(address: Hex): Promise<boolean> {
        if (!userHasWallet(this.user, address)) {
            return false;
        }

        const allowance = await this.repos.walletTransactionAllowances.latestForUser(this.user.id);
        if (!allowance) {
            return false;
        }

        return areHexEqual(allowance.walletAddress, address);
    }
}
