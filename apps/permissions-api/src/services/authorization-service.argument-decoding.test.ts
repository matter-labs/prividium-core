import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import pino from 'pino';
import { type Address, encodeFunctionData, type Hex, parseAbi, toFunctionSelector } from 'viem';
import { describe, expect } from 'vitest';
import { type DB, Repositories } from '#db/index';
import type { MethodRule } from '#db/schema';
import { AuthData } from '#middleware/auth-data';
import { regularRpcRoutes } from '#routes/regular-rpc-routes';
import { FORBIDDEN_ERROR_CODE } from '#rpc/constants';
import { RpcAuthorizer } from '#rpc/permissions/rpc-authorizer';
import { TestExternalRpc } from '#test/rpc/test-external-rpc';
import { it } from '#test/unit-test-context';
import { type AuthorizationResult, AuthorizationService } from './authorization-service';
import { EventPermissionVerifier } from './event-permission-verifier';

const wallet: Address = '0x1111111111111111111111111111111111111111';
const other: Address = '0x2222222222222222222222222222222222222222';
const contractAddress: Address = '0x3333333333333333333333333333333333333333';
const functionSignature = 'function inspect(address who, bytes[] items) view';
const abi = parseAbi([functionSignature]);
const selector = toFunctionSelector(functionSignature);
const word = (value: number | bigint) => BigInt(value).toString(16).padStart(64, '0');
const canonical = (who: Address) => encodeFunctionData({ abi, functionName: 'inspect', args: [who, ['0xab']] });

// Small equivalents exercise authorization wiring without an OOM if the guard regresses.
const attacks: Hex[] = [
    `${selector}${word(BigInt(other))}${word(64)}${word(4)}${word(96)}${word(0).repeat(3)}`,
    `${selector}${word(BigInt(other))}${word(64)}${word(5)}${word(160).repeat(5)}${word(65536)}${'ab'.repeat(65536)}`,
    `${selector}${word(BigInt(other))}${word(65)}${word(0)}${word(0)}`,
    `${selector}${word(BigInt(other))}${word(64)}${word(2n ** 255n)}`
];
const decodeDenied: AuthorizationResult = { authorized: false, ruleId: 'rule.restrict_argument.decode_failed' };

async function setup(db: DB, ruleType: MethodRule, template: boolean, hasRole: boolean) {
    const repos = new Repositories(db);
    const role = await repos.roles.create({ roleName: 'Reader', systemPermissions: [] });
    const user = await repos.users.create({
        displayName: 'Reader',
        source: 'adminPanel',
        roles: hasRole ? [role.id] : [],
        wallets: [wallet]
    });
    const permission = {
        functionSignature,
        accessType: 'read' as const,
        ruleType,
        ...(['public', 'restrictArgument'].includes(ruleType) ? {} : { roles: [role] }),
        ...(['public', 'checkRole'].includes(ruleType) ? {} : { argumentRestrictions: [{ argumentIndex: 0 }] })
    };
    if (template) {
        const row = await repos.templates.create({
            templateKey: 'inspect',
            name: 'Inspect',
            description: null,
            abi: JSON.stringify(abi)
        });
        await repos.templatePermissions.create({ templateId: row.id, ...permission });
    }
    await repos.contracts.create({
        contractAddress,
        name: 'Inspect',
        description: null,
        disclosureStartBlock: '0x0',
        abi: JSON.stringify(template ? [] : abi),
        ...(template ? { templateKey: 'inspect' } : {})
    });
    if (!template) await repos.contractFunctionPermissions.create({ contractAddress, ...permission });
    const service = new AuthorizationService({ repos });
    const request = { fromAddress: wallet, user, contractAddress, accessTypeCheck: 'read' as const };
    return {
        repos,
        service,
        user,
        direct: (calldata: Hex) => service.checkMethodAuthorizationForUser({ ...request, calldata }),
        batch: (data: Hex[], umbrellaCovered = false) =>
            service.checkUserAuthorizationForCalls({
                ...request,
                calls: data.map((calldata) => ({ contractAddress, calldata, umbrellaCovered }))
            })
    };
}

describe('argument decoding in direct and batched authorization', () => {
    it('refuses RPC calls before forwarding and accepts a subsequent valid call', async ({ db }) => {
        const { repos, service, user } = await setup(db, 'restrictArgument', false, false);
        const targetRpc = new TestExternalRpc();
        const auth = new AuthData({ user, targetType: 'user', expiresAt: new Date(), authMethod: 'session' });
        const app = Fastify({ loggerInstance: pino({ level: 'silent' }) }).withTypeProvider<ZodTypeProvider>();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        app.register(regularRpcRoutes, {
            prefix: '/rpc',
            preHandler: async (request) => {
                request.auth = auth;
            },
            buildContext: (request) => ({
                targetRpc,
                authorizer: new RpcAuthorizer(
                    auth,
                    service,
                    repos,
                    new EventPermissionVerifier(repos, false),
                    targetRpc,
                    request.log,
                    request.id
                )
            }),
            publicCodeAddresses: [],
            disclosureMethodsEnabled: false
        });
        const rpcCall = (data: Hex, id: number) => {
            targetRpc.registerDelegate(String(id), { jsonrpc: '2.0', id, result: '0x' });
            return app.inject({
                method: 'POST',
                url: '/rpc',
                payload: {
                    jsonrpc: '2.0',
                    id,
                    method: 'eth_call',
                    params: [{ from: wallet, to: contractAddress, data }, 'latest']
                }
            });
        };
        try {
            for (const [id, data] of attacks.entries()) {
                const response = await rpcCall(data, id);
                expect(response.statusCode).toBe(200);
                expect(response.json()).toMatchObject({ error: { code: FORBIDDEN_ERROR_CODE } });
            }
            expect(targetRpc.delegateRegistry).toHaveLength(0);
            const response = await rpcCall(canonical(wallet), attacks.length);
            expect(response.json()).toEqual({ jsonrpc: '2.0', id: attacks.length, result: '0x' });
            expect(targetRpc.delegateRegistry).toHaveLength(1);
        } finally {
            await app.close();
        }
    });

    for (const template of [false, true]) {
        for (const ruleType of [
            'restrictArgument',
            'checkRoleOrRestrictArgument',
            'checkRoleAndRestrictArgument'
        ] as const) {
            it(`bounds ${ruleType} with ${template ? 'template' : 'contract'} permissions`, async ({ db }) => {
                const { direct, batch } = await setup(
                    db,
                    ruleType,
                    template,
                    ruleType === 'checkRoleAndRestrictArgument'
                );
                for (const data of attacks) expect(await direct(data)).toEqual(decodeDenied);
                for (const data of attacks) {
                    expect(await direct(data.replace(word(BigInt(other)), word(BigInt(wallet))) as Hex)).toEqual(
                        decodeDenied
                    );
                }
                expect(await direct(canonical(wallet))).toMatchObject({ authorized: true });
                expect(await direct(canonical(other))).toMatchObject({ authorized: false });
                const results = await batch([...attacks, canonical(wallet), canonical(other)]);
                expect(results).toEqual([
                    ...attacks.map(() => ({ kind: 'result', result: decodeDenied })),
                    { kind: 'result', result: expect.objectContaining({ authorized: true }) },
                    { kind: 'result', result: expect.objectContaining({ authorized: false }) }
                ]);
                expect(await batch(attacks, true)).toEqual(
                    attacks.map(() => ({ kind: 'result', result: decodeDenied }))
                );
            });
        }
    }

    for (const ruleType of ['public', 'checkRole', 'checkRoleOrRestrictArgument'] as const) {
        it(`preserves ${ruleType} grants independent of argument matching`, async ({ db }) => {
            const { direct, batch } = await setup(db, ruleType, false, true);
            for (const data of attacks) expect(await direct(data)).toMatchObject({ authorized: true });
            expect(await batch(attacks)).toEqual(
                attacks.map(() => ({ kind: 'result', result: expect.objectContaining({ authorized: true }) }))
            );
        });
    }
});
