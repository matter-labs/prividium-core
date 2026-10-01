import { pad } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import type { Repositories } from '../db';
import type { UserWithRoles } from '../repositories/users-repository';
import { AdmitService } from './admit-service';
import { AuthorizationService } from './authorization-service';
import { JudgeService, type TraceFrame } from './judge-service';
import type { TransactionClassifier } from './transaction-classifier';

/**
 * Admit and judge reach the native service only through `SequencerAuthorizer`. These pin that it
 * receives the requests the services built when they called it directly.
 */
describe('SequencerAuthorizer — the native service', () => {
    const PROTOCOL_VERSION = '1';
    const signer = pad('0x01', { size: 20 });
    const target = pad('0x02', { size: 20 });
    const inner = pad('0x03', { size: 20 });
    const user = {
        id: 'u1',
        organizationId: null,
        organization: null,
        roles: [],
        wallets: []
    } as unknown as UserWithRoles;
    const allow = { authorized: true, ruleId: 'rule.public.allow' } as const;

    function nativeResolving(subject: UserWithRoles) {
        const repos = {
            users: { findByAddressWithRoles: vi.fn().mockResolvedValue(subject) }
        } as unknown as Repositories;
        return new AuthorizationService({ repos });
    }

    const classifying = (type: 'contract-call' | 'transfer-to-eoa') =>
        ({ classifyTransaction: vi.fn().mockResolvedValue({ type }) }) as unknown as TransactionClassifier;

    const admitInput = (to: typeof target | undefined) => ({
        protocolVersion: PROTOCOL_VERSION,
        from: signer,
        to,
        value: 0n,
        calldata: '0x12345678' as const,
        gasLimit: 100_000,
        accessType: 'write' as const
    });

    it('admit puts a contract call to the method check', async () => {
        const authorizer = nativeResolving(user);
        const check = vi.spyOn(authorizer, 'checkMethodAuthorizationForUser').mockResolvedValue(allow);
        const admit = new AdmitService({
            authorizer,
            transactionClassifier: classifying('contract-call'),
            protocolVersions: [PROTOCOL_VERSION]
        });

        expect(await admit.admit(admitInput(target))).toEqual(allow);
        expect(check).toHaveBeenCalledWith({
            fromAddress: signer,
            user,
            contractAddress: target,
            calldata: '0x12345678',
            accessTypeCheck: 'write'
        });
    });

    it('admit puts a contract creation to the deployment check', async () => {
        const authorizer = nativeResolving(user);
        const check = vi.spyOn(authorizer, 'checkDeploymentAuthorization');
        const admit = new AdmitService({
            authorizer,
            transactionClassifier: classifying('contract-call'),
            protocolVersions: [PROTOCOL_VERSION]
        });

        expect(await admit.admit(admitInput(undefined))).toEqual({
            authorized: false,
            ruleId: 'deploy.address_not_owned'
        });
        expect(check).toHaveBeenCalledWith({ from: signer, user });
    });

    it('admit refuses a signer whose organization is deleted before it classifies the call', async () => {
        const deleted = { ...user, organizationId: 'org', organization: { deletedAt: new Date() } } as UserWithRoles;
        const transactionClassifier = classifying('transfer-to-eoa');
        const admit = new AdmitService({
            authorizer: nativeResolving(deleted),
            transactionClassifier,
            protocolVersions: [PROTOCOL_VERSION]
        });

        expect(await admit.admit(admitInput(target))).toEqual({
            authorized: false,
            ruleId: 'user.organization_deleted'
        });
        expect(transactionClassifier.classifyTransaction).not.toHaveBeenCalled();
    });

    it('judge puts the root to the method check and each generation to the batched check', async () => {
        const root: TraceFrame = {
            caller: signer,
            callee: target,
            value: '0x0',
            calldata: '0x12345678',
            deploys: [],
            callKind: 'call',
            children: [
                {
                    caller: target,
                    callee: inner,
                    value: '0x0',
                    calldata: '0xabcdef01',
                    deploys: [],
                    callKind: 'call',
                    children: []
                }
            ]
        };
        const authorizer = nativeResolving(user);
        const rootCheck = vi.spyOn(authorizer, 'checkMethodAuthorizationForUser').mockResolvedValue(allow);
        const batch = vi
            .spyOn(authorizer, 'checkUserAuthorizationForCalls')
            .mockResolvedValue([{ kind: 'result', result: allow }]);
        const judge = new JudgeService({
            authorizer,
            transactionClassifier: classifying('contract-call'),
            logger: { error: vi.fn() } as never,
            protocolVersions: [PROTOCOL_VERSION]
        });

        expect(
            await judge.judge({ protocolVersion: PROTOCOL_VERSION, trace: { frame: root }, accessType: 'write' })
        ).toEqual({ authorized: true, ruleId: 'judge.allow' });
        expect(rootCheck).toHaveBeenCalledWith({
            fromAddress: signer,
            user,
            contractAddress: target,
            calldata: '0x12345678',
            accessTypeCheck: 'write'
        });
        expect(batch).toHaveBeenCalledWith({
            fromAddress: signer,
            user,
            calls: [{ contractAddress: inner, calldata: '0xabcdef01', umbrellaCovered: false }],
            accessTypeCheck: 'unenforced'
        });
    });
});
