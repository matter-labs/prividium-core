export function getFirstOrThrow<T>(value: T[]): T {
    const firstValue = getFirst(value);
    if (firstValue === undefined) {
        throw new Error('First element is undefined');
    }
    return firstValue;
}

export function getFirst<T>(value: T[]): T | undefined {
    return value[0];
}

/**
 * Escape LIKE/ILIKE wildcard metacharacters (`%`, `_`, `\`) in user-supplied search input so they
 * are matched literally instead of as wildcards.
 */
export function escapeLike(value: string): string {
    return value.replace(/[%_\\]/g, '\\$&');
}
