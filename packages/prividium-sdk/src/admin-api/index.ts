import type { ApiCaller } from '../chain-core.js';
import { type ContractsAdminMethods, createContractsAdminMethods } from './contracts.js';
import { createUsersAdminMethods, type UsersAdminMethods } from './users.js';

export interface AdminMethods {
    users: UsersAdminMethods;
    contracts: ContractsAdminMethods;
}

export function createAdminMethods(deps: { prividiumApiCall: ApiCaller; prividiumApiBaseUrl: string }): AdminMethods {
    return {
        users: createUsersAdminMethods(deps),
        contracts: createContractsAdminMethods(deps)
    };
}

export type { ContractsAdminMethods } from './contracts.js';
export type { AdminContract, AdminContractCreate, AdminUser, AdminUserUpdate, AdminUserUpdateInput } from './types.js';
export type { UsersAdminMethods } from './users.js';
