import type {
    GetUsersByIdResponses,
    PostContractsData,
    PostContractsResponses,
    PutUsersByIdData
} from '@repo/api-types/permissions-api';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { adminContractSchema, adminUserSchema } from './schemas.js';
import type { AdminContract, AdminContractCreate, AdminUser, AdminUserUpdate, AdminUserUpdateInput } from './types.js';

// These tests enforce structural equivalence between (a) the SDK's hand-written admin types,
// (b) the SDK's runtime Zod schemas, and (c) the generated TypeScript types from @repo/api-types.
// Any drift in the upstream OpenAPI spec changes the @repo/api-types side and breaks one of the
// directional assignments below at compile time — pnpm typecheck:test surfaces it before publish.
// @repo/api-types is a devDependency and is never referenced from the SDK's published source,
// so this typecheck-only safeguard does not leak into shipped artifacts.

type ApiAdminUser = GetUsersByIdResponses[200];
type ApiAdminUserUpdate = NonNullable<PutUsersByIdData['body']>;
type ApiAdminContract = PostContractsResponses[201];
type ApiAdminContractCreate = PostContractsData['body'];

describe('admin API type alignment with @repo/api-types', () => {
    it('AdminUser ↔ GetUsersByIdResponses[200]', () => {
        const fromSdk = null as unknown as AdminUser;
        const fromApi = null as unknown as ApiAdminUser;
        const _a: ApiAdminUser = fromSdk;
        const _b: AdminUser = fromApi;
        expect(_a).toBeNull();
        expect(_b).toBeNull();
    });

    it('AdminUserUpdate ↔ PutUsersByIdData["body"]', () => {
        const fromSdk = null as unknown as AdminUserUpdate;
        const fromApi = null as unknown as ApiAdminUserUpdate;
        const _a: ApiAdminUserUpdate = fromSdk;
        const _b: AdminUserUpdate = fromApi;
        expect(_a).toBeNull();
        expect(_b).toBeNull();

        // Bidirectional `extends` is vacuously true for two all-optional types with disjoint
        // property sets. Force per-property comparison so a renamed/typed field is caught.
        // PUT /users/{id} is a full replacement: the body is exactly these three required fields.
        type Concrete = Required<Pick<ApiAdminUserUpdate, 'displayName' | 'roles' | 'wallets'>>;
        const concreteFromSdk = null as unknown as Required<Pick<AdminUserUpdate, 'displayName' | 'roles' | 'wallets'>>;
        const concreteFromApi = null as unknown as Concrete;
        const _c: Concrete = concreteFromSdk;
        const _d: typeof concreteFromSdk = concreteFromApi;
        expect(_c).toBeNull();
        expect(_d).toBeNull();
    });

    it('AdminContract ↔ PostContractsResponses[201]', () => {
        const fromSdk = null as unknown as AdminContract;
        const fromApi = null as unknown as ApiAdminContract;
        const _a: ApiAdminContract = fromSdk;
        const _b: AdminContract = fromApi;
        expect(_a).toBeNull();
        expect(_b).toBeNull();
    });

    it('AdminContractCreate ↔ PostContractsData["body"]', () => {
        const fromSdk = null as unknown as AdminContractCreate;
        const fromApi = null as unknown as ApiAdminContractCreate;
        const _a: ApiAdminContractCreate = fromSdk;
        const _b: AdminContractCreate = fromApi;
        expect(_a).toBeNull();
        expect(_b).toBeNull();
    });

    it('adminUserSchema inferred type ↔ AdminUser (runtime/static parity)', () => {
        const fromSchema = null as unknown as z.infer<typeof adminUserSchema>;
        const fromType = null as unknown as AdminUser;
        const _a: AdminUser = fromSchema;
        const _b: z.infer<typeof adminUserSchema> = fromType;
        expect(_a).toBeNull();
        expect(_b).toBeNull();
    });

    it('adminContractSchema inferred type ↔ AdminContract (runtime/static parity)', () => {
        const fromSchema = null as unknown as z.infer<typeof adminContractSchema>;
        const fromType = null as unknown as AdminContract;
        const _a: AdminContract = fromSchema;
        const _b: z.infer<typeof adminContractSchema> = fromType;
        expect(_a).toBeNull();
        expect(_b).toBeNull();
    });

    it('AdminUserUpdate is the full-replacement wire body; AdminUserUpdateInput allows partial input', () => {
        // The wire body matches the strict PUT route: all three fields required.
        const wire: AdminUserUpdate = { displayName: 'Ada', roles: ['admin'], wallets: ['0xabc'] };
        const _wire: ApiAdminUserUpdate = wire;
        expect(_wire).toBe(wire);
        expect(wire.wallets).toEqual(['0xabc']);

        // The public update() input stays partial, so wallets-only updates remain a
        // supported consumer use case (the SDK merges omitted fields before the PUT).
        const partial: AdminUserUpdateInput = { wallets: ['0xabc'] };
        expect(partial.displayName).toBeUndefined();
    });

    it('AdminContractCreate matches the auth-server-api whitelistContract body', () => {
        const create: AdminContractCreate = {
            contractAddress: '0xabc',
            templateKey: 'erc20',
            abi: '[]',
            name: null,
            description: null,
            discloseErc20TotalSupply: false,
            discloseBytecode: false,
            disclosureStartBlock: '0x0'
        };
        expect(create.contractAddress).toBe('0xabc');
    });
});
