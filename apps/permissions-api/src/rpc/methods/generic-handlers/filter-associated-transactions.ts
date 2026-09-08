import type { Hex } from 'viem';
import type { AddressSet } from '../../address-set';
import { ZERO_LOGS_BLOOM } from '../../constants';
import type { Authorizer } from '../../permissions';
import type { GetTransactionByHashResponse, GetTransactionReceiptsResponse } from '../handlers';

export type Transaction = NonNullable<GetTransactionByHashResponse>;
export type Receipt = NonNullable<GetTransactionReceiptsResponse>;

export type AssociatedTransactionArgs = { associatedAddresses: AddressSet } & {
    transaction: Transaction | null;
    receipt: Receipt;
};

type Tx = Transaction | Hex | null;

export type FilteredReceipt<T extends Tx> = { keep: false } | { keep: true; receipt: Receipt; transaction: T };

export function participantAddresses(items: { from: Hex; to?: Hex | null }[]): Hex[] {
    const candidates = new Set<Hex>();
    for (const item of items) {
        candidates.add(item.from);
        if (item.to) candidates.add(item.to);
    }
    return [...candidates];
}

export async function filterTransactionAndReceipt<T extends Tx>(
    receipt: Receipt,
    transaction: T,
    associatedAddresses: AddressSet,
    authorizer: Authorizer
): Promise<FilteredReceipt<T>> {
    const fromAddress = receipt.from;

    // To address is optional, because it might be a contract creation transaction
    const toAddress = receipt?.to;

    if (
        associatedAddresses.has(fromAddress) ||
        (toAddress && associatedAddresses.has(toAddress)) ||
        (toAddress && (await authorizer.hasOrgVisibilityOver(toAddress)))
    ) {
        return { keep: true, transaction: transaction, receipt: { ...receipt, logsBloom: ZERO_LOGS_BLOOM } };
    }

    const logsToPreserve = await authorizer.checkBatchEventRead(receipt.logs);

    if (logsToPreserve.length > 0) {
        let filteredTx = transaction;
        if (transaction !== null && typeof transaction === 'object' && 'input' in transaction) {
            filteredTx = {
                ...transaction,
                input: '0x'
            };
        }

        return {
            keep: true,
            receipt: { ...receipt, logs: logsToPreserve, logsBloom: ZERO_LOGS_BLOOM },
            transaction: filteredTx
        };
    }

    return { keep: false };
}
