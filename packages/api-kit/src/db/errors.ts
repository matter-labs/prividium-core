import { DrizzleQueryError } from 'drizzle-orm/errors';
import { DatabaseError } from 'pg';

export const PostgresError = {
    FOREIGN_KEY_VIOLATION: '23503',
    UNIQUE_VIOLATION: '23505',
    CHECK_VIOLATION: '23514',
    INVALID_TEXT_REPRESENTATION: '22P02',
    NUMERIC_VALUE_OUT_OF_RANGE: '22003',
    STRING_DATA_RIGHT_TRUNCATION: '22001'
};

export function isUniqueConstraintError(err: unknown): boolean {
    return isPostgresError(err) && err.cause.code === PostgresError.UNIQUE_VIOLATION;
}

export function isForeignKeyConstraintError(err: unknown): boolean {
    return isPostgresError(err) && err.cause.code === PostgresError.FOREIGN_KEY_VIOLATION;
}

export function extractForeignKeyConstraintProblem(err: unknown): string {
    const errObj = err as {
        cause?: {
            detail?: string;
        };
    };

    if (errObj === undefined || errObj.cause === undefined || typeof errObj.cause.detail !== 'string') {
        return 'unknown';
    }

    const key = /=\((.*)\) is not present/.exec(errObj.cause.detail) || [];
    return key[1] ?? '';
}

export function isPostgresError(err: unknown): err is DrizzleQueryError & { cause: DatabaseError } {
    return err instanceof DrizzleQueryError && err.cause instanceof DatabaseError;
}

export function isNoValuesToSetError(err: unknown): boolean {
    return err instanceof Error && err.message === 'No values to set';
}
