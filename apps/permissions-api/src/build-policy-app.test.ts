import pino from 'pino';
import { encodeFunctionData, type Hex, pad, parseAbiItem } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import { buildPolicyApp, type PolicyAppConfig, type PolicyServer } from './build-policy-app';
import type { DB } from './db';
import { AuthorizationService, type SequencerAuthorizer } from './services/authorization-service';

describe('buildPolicyApp — a supplied sequencer authorizer', () => {
    const PROTOCOL_VERSION = '1';
    const signer = pad('0x01', { size: 20 });
    const contract = pad('0x02', { size: 20 });
    const calldata = encodeFunctionData({
        abi: [parseAbiItem('function transfer(address,uint256)')],
        functionName: 'transfer',
        args: [signer, 1n]
    });
    const subject = { engineSubject: 'wallet-1' };
    const denied = { authorized: false, ruleId: 'authorizer.test_denied' };

    // The supplied authorizer answers every question, so nothing reaches the database.
    // The unreachable RPC URL would fail any request that reaches native-transfer classification.
    function build(authorizer: SequencerAuthorizer<unknown>, config: Partial<PolicyAppConfig> = {}) {
        const sequencerAuthorizerFor = vi.fn<NonNullable<PolicyAppConfig['sequencerAuthorizerFor']>>(() => authorizer);
        const app = buildPolicyApp({ $client: {} } as unknown as DB, {
            logger: pino({ level: 'silent' }),
            protocolVersions: [PROTOCOL_VERSION],
            multiOrgEnabled: false,
            targetRpcUrl: 'http://127.0.0.1:1',
            sequencerAuthorizerFor,
            ...config
        });
        return { app, sequencerAuthorizerFor };
    }

    const authorizerWith = (overrides: Partial<SequencerAuthorizer<unknown>>): SequencerAuthorizer<unknown> => ({
        resolveSigner: vi.fn().mockResolvedValue(subject),
        checkSigner: vi.fn().mockResolvedValue(undefined),
        checkTransfer: vi.fn().mockResolvedValue({ authorized: true }),
        checkCall: vi.fn().mockResolvedValue({ authorized: true }),
        checkFrames: vi.fn().mockResolvedValue([]),
        checkDeployment: vi.fn().mockResolvedValue({ authorized: true }),
        ...overrides
    });

    const admit = (app: PolicyServer, overrides: Record<string, unknown> = {}) =>
        app.inject({
            method: 'POST',
            url: '/admit',
            payload: {
                protocolVersion: PROTOCOL_VERSION,
                from: signer,
                to: contract,
                value: '0x0',
                calldata,
                gasLimit: 100_000,
                accessType: 'write',
                ...overrides
            }
        });

    const frame = (caller: Hex, callee: Hex, children: unknown[] = []) => ({
        caller,
        callee,
        value: '0x0',
        calldata,
        deploys: [],
        callKind: 'call',
        children
    });

    const judge = (app: PolicyServer) =>
        app.inject({
            method: 'POST',
            url: '/judge',
            payload: {
                protocolVersion: PROTOCOL_VERSION,
                accessType: 'write',
                trace: { frame: frame(signer, contract, [frame(contract, contract)]) }
            }
        });

    it('decides /admit with the supplied authorizer, which is handed the core one', async () => {
        const checkCall = vi.fn().mockResolvedValue(denied);
        const { app, sequencerAuthorizerFor } = build(authorizerWith({ checkCall }));

        const response = await admit(app);

        expect(response.json()).toMatchObject({ allow: false, ruleId: denied.ruleId });
        expect(checkCall).toHaveBeenCalledWith(
            subject,
            { contractAddress: contract, calldata },
            { from: signer, accessType: 'write' }
        );
        expect(sequencerAuthorizerFor).toHaveBeenCalledOnce();
        expect(sequencerAuthorizerFor.mock.calls[0]?.[1]).toBeInstanceOf(AuthorizationService);
    });

    it('returns the signer refusal on /admit before the call is classified', async () => {
        const checkCall = vi.fn();
        const refusal = { authorized: false, ruleId: 'authorizer.signer_refused' };
        const { app } = build(authorizerWith({ checkSigner: vi.fn().mockResolvedValue(refusal), checkCall }));

        const response = await admit(app, { calldata: '0x', value: '0x1' });

        expect(response.json()).toMatchObject({ allow: false, ruleId: refusal.ruleId });
        expect(checkCall).not.toHaveBeenCalled();
    });

    it('refuses /admit for a signer the authorizer does not resolve', async () => {
        const { app } = build(authorizerWith({ resolveSigner: vi.fn().mockResolvedValue(undefined) }));

        expect((await admit(app)).json()).toMatchObject({ allow: false, ruleId: 'user.not_found' });
    });

    it('decides a contract creation on /admit with checkDeployment', async () => {
        const checkDeployment = vi.fn().mockResolvedValue(denied);
        const { app } = build(authorizerWith({ checkDeployment }));

        const response = await admit(app, { to: undefined });

        expect(response.json()).toMatchObject({ allow: false, ruleId: denied.ruleId });
        expect(checkDeployment).toHaveBeenCalledWith(subject, signer);
    });

    it('answers 500 on /admit when the authorizer throws, and caches nothing', async () => {
        const checkCall = vi.fn().mockRejectedValue(new Error('engine unavailable'));
        const { app } = build(authorizerWith({ checkCall }), { decisionCache: { ttlMs: 60_000, maxEntries: 10 } });

        expect((await admit(app)).statusCode).toBe(500);
        expect((await admit(app)).statusCode).toBe(500);
        expect(checkCall).toHaveBeenCalledTimes(2);
    });

    it('decides /judge frames with the supplied authorizer, without the signer refusal', async () => {
        const checkSigner = vi.fn();
        const checkFrames = vi.fn().mockResolvedValue([{ kind: 'result', result: denied }]);
        const { app } = build(authorizerWith({ checkSigner, checkFrames }));

        const response = await judge(app);

        expect(response.json()).toMatchObject({ allow: false, ruleId: denied.ruleId });
        expect(checkFrames).toHaveBeenCalledWith(
            subject,
            [expect.objectContaining({ contractAddress: contract, calldata })],
            { from: signer, accessType: 'unenforced' }
        );
        expect(checkSigner).not.toHaveBeenCalled();
    });

    it('fails /judge closed when checkFrames returns fewer results than frames', async () => {
        const { app } = build(authorizerWith({ checkFrames: vi.fn().mockResolvedValue([]) }));

        expect((await judge(app)).statusCode).toBe(500);
    });
});
