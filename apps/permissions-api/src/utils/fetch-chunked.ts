/**
 * Conservative cap on keys per `IN (...)` statement, well under the Postgres
 * 65535 bound-parameter limit. Larger key sets are split into chunks of this
 * size and the chunks run concurrently.
 */
export const QUERY_CHUNK_SIZE = 1000;

/**
 * Runs `query` over `items` split into {@link QUERY_CHUNK_SIZE}-key chunks so a
 * single `IN (...)` stays under the Postgres bound-parameter limit, and flattens
 * the per-chunk rows back into one array. Chunks run concurrently.
 */
export async function fetchChunked<I, R>(items: I[], query: (chunk: I[]) => Promise<R[]>): Promise<R[]> {
    if (items.length === 0) return [];
    if (items.length <= QUERY_CHUNK_SIZE) return query(items);
    const chunks: I[][] = [];
    for (let i = 0; i < items.length; i += QUERY_CHUNK_SIZE) {
        chunks.push(items.slice(i, i + QUERY_CHUNK_SIZE));
    }
    const results = await Promise.all(chunks.map((chunk) => query(chunk)));
    return results.flat();
}
