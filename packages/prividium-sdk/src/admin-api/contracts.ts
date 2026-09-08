import type { ApiCaller } from '../chain-core.js';
import { adminContractSchema } from './schemas.js';
import type { AdminContract, AdminContractCreate } from './types.js';

export interface ContractsAdminMethods {
    create(params: AdminContractCreate): Promise<AdminContract>;
}

export function createContractsAdminMethods(deps: {
    prividiumApiCall: ApiCaller;
    prividiumApiBaseUrl: string;
}): ContractsAdminMethods {
    const { prividiumApiCall, prividiumApiBaseUrl } = deps;
    const url = `${prividiumApiBaseUrl}/api/contracts`;

    return {
        async create(params) {
            return prividiumApiCall(adminContractSchema, url, 'POST', JSON.stringify(params));
        }
    };
}
