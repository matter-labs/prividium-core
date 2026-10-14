import { encodeFunctionData, pad, parseAbiItem } from 'viem';
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
        suspendedAt: null,
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

    it('admit refuses a suspended signer before it classifies the call', async () => {
        const transactionClassifier = classifying('transfer-to-eoa');
        const admit = new AdmitService({
            authorizer: nativeResolving({ ...user, suspendedAt: new Date() }),
            transactionClassifier,
            protocolVersions: [PROTOCOL_VERSION]
        });

        expect(await admit.admit(admitInput(target))).toEqual({ authorized: false, ruleId: 'user.suspended' });
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

describe('SequencerAuthorizer — the watchdog', () => {
    const signer = pad('0x01', { size: 20 });
    const watchdog = {
        id: 'watchdog',
        source: 'watchdog',
        organizationId: null,
        organization: null,
        suspendedAt: null,
        roles: [],
        wallets: [{ walletAddress: signer }]
    } as unknown as UserWithRoles;
    // Anything the grant asks of the database fails the test.
    const authorizer = new AuthorizationService({ repos: {} as Repositories });
    const facts = { from: signer, accessType: 'write' } as const;
    const withdraw = encodeFunctionData({
        abi: [parseAbiItem('function withdraw(address _l1Receiver) payable')],
        args: [signer]
    });

    const notGranted = { authorized: false, ruleId: 'watchdog.not_granted' };

    it('decides its calls and frames from the grant, without reading permission rows', async () => {
        const granted = { contractAddress: '0x000000000000000000000000000000000000800A', calldata: withdraw } as const;
        const other = { contractAddress: pad('0x02', { size: 20 }), calldata: '0x12345678' } as const;
        const messenger = { contractAddress: '0x0000000000000000000000000000000000008008', calldata: '0x' } as const;

        expect(await authorizer.checkCall(watchdog, granted, facts)).toMatchObject({
            authorized: true,
            ruleId: 'watchdog.grant'
        });
        expect(await authorizer.checkCall(watchdog, other, facts)).toEqual(notGranted);
        expect(
            await authorizer.checkFrames(
                watchdog,
                [
                    { ...messenger, umbrellaCovered: false },
                    { ...other, umbrellaCovered: true }
                ],
                facts
            )
        ).toEqual([
            { kind: 'result', result: expect.objectContaining({ authorized: true, ruleId: 'watchdog.grant' }) },
            { kind: 'result', result: notGranted }
        ]);
    });

    it('refuses its deployments, whatever its roles', async () => {
        const deployer = { ...watchdog, roles: [{ systemPermissions: ['contract_deployment'] }] } as UserWithRoles;

        expect(await authorizer.checkDeployment(deployer, signer)).toEqual(notGranted);
    });
});
