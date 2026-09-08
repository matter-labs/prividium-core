import type { DbOrTx, RawTxType, TxType } from '../db';

type TxAugmentor = (rawTx: RawTxType) => TxType;

export class BaseRepository {
    // Overridden by Repositories (db/repositories.ts) to avoid circular imports.
    static augmentTx: TxAugmentor = (rawTx) => rawTx as unknown as TxType;

    constructor(protected readonly db: DbOrTx) {}

    protected transaction<T>(fn: (tx: TxType) => Promise<T>): Promise<T> {
        return this.db.transaction((rawTx) => fn(BaseRepository.augmentTx(rawTx)));
    }
}
