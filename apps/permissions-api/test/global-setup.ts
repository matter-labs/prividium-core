import path from 'node:path';
import { setupTestDatabase } from '@repo/test-deps';

export const MIGRATIONS_FOLDER = path.join(__dirname, '..', 'drizzle');

export const TEMPLATE_DB_PREFIX = 'permissions_api_unit_tests';

export default async function globalSetup() {
    return setupTestDatabase(MIGRATIONS_FOLDER, TEMPLATE_DB_PREFIX);
}
