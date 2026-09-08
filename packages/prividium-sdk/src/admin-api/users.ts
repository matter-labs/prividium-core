import type { ApiCaller, HttpMethod } from '../chain-core.js';
import { adminUserResponseSchema } from './schemas.js';
import type { AdminUser, AdminUserUpdate, AdminUserUpdateInput } from './types.js';

export interface UsersAdminMethods {
    getById(userId: string): Promise<AdminUser>;
    update(userId: string, params: AdminUserUpdateInput): Promise<AdminUser>;
}

export function createUsersAdminMethods(deps: {
    prividiumApiCall: ApiCaller;
    prividiumApiBaseUrl: string;
}): UsersAdminMethods {
    const { prividiumApiCall, prividiumApiBaseUrl } = deps;
    const baseUrl = (id: string) => `${prividiumApiBaseUrl}/api/users/${encodeURIComponent(id)}`;

    // Both the GET and the PUT return a user object carrying roles. adminUserResponseSchema accepts the
    // current shape and older name-keyed ones, normalizing to the latest (see schemas.ts).
    const readUser = (url: string, method: HttpMethod, body?: string): Promise<AdminUser> =>
        prividiumApiCall(adminUserResponseSchema, url, method, body);

    const getById = (userId: string) => readUser(baseUrl(userId), 'GET');

    return {
        getById,
        async update(userId, params) {
            // PUT /users/{id} is a full replacement. To keep partial updates working,
            // fetch the current user and merge in any omitted fields before sending.
            // When the caller already provides every field, skip the extra round-trip.
            // `role.id` is the surrogate id on a modern server and the role name on a legacy one (see
            // readUser), so the same mapping produces the identifier each server expects.
            let body: AdminUserUpdate;
            if (params.displayName !== undefined && params.roles !== undefined && params.wallets !== undefined) {
                body = {
                    displayName: params.displayName,
                    roles: params.roles.map((role) => role.id),
                    wallets: params.wallets
                };
            } else {
                const current = await getById(userId);
                body = {
                    displayName: params.displayName ?? current.displayName,
                    roles: params.roles?.map((role) => role.id) ?? current.roles.map((role) => role.id),
                    wallets: params.wallets ?? current.wallets.map((wallet) => wallet.walletAddress)
                };
            }
            return readUser(baseUrl(userId), 'PUT', JSON.stringify(body));
        }
    };
}
