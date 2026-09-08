import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import type { Repositories } from '../db';
import type { PasskeyTransport } from '../db/schema';
import type { User } from '../repositories/users-repository';
import { InvalidInputError, UnauthorizedError } from '../utils/error-types';
import type { WebAuthnAuthenticationResponse } from '../utils/schemas/webauthn';
import type { PasskeyService } from './passkey-service';

export interface StepUpBeginResult {
    rpId: string;
    challenge: string;
    allowCredentials: { id: string; type: 'public-key'; transports?: PasskeyTransport[] }[];
}

export interface StepUpFinishResult {
    proof: string;
    expiresAt: Date;
}

export type StepUpRejectionReason =
    | 'missing'
    | 'expired'
    | 'wrong_action'
    | 'wrong_session'
    | 'wrong_user'
    | 'already_consumed';

export class StepUpRejected extends UnauthorizedError {
    constructor(public readonly reason: StepUpRejectionReason) {
        super(`Step-up required: ${reason}`);
    }
}

interface StepUpServiceDeps {
    passkeyService: PasskeyService;
    repos: Repositories;
}

const STEP_UP_PROOF_TTL_MS = 2 * 60 * 1000;

export class StepUpService {
    private readonly passkeyService: PasskeyService;
    private readonly repos: Repositories;

    constructor({ passkeyService, repos }: StepUpServiceDeps) {
        this.passkeyService = passkeyService;
        this.repos = repos;
    }

    static hashProof(proof: string): string {
        return createHash('sha256').update(proof).digest('hex');
    }

    /**
     * Issue a WebAuthn assertion challenge bound to the given action.
     * Requires the user to have at least one enrolled passkey — without one
     * there is nothing to step up against.
     *
     * The action is persisted with the challenge so that finish() can verify
     * the caller did not claim a different action than the one begin was
     * issued for.
     */
    async begin({ user, action }: { user: User; action: string }): Promise<StepUpBeginResult> {
        const existingCredentials = await this.repos.passkeyCredentials.findByUserId(user.id);
        if (existingCredentials.length === 0) {
            throw new InvalidInputError('Cannot step up: no passkey enrolled for this user');
        }

        const result = await this.passkeyService.beginAuthentication({
            userId: user.id,
            existingCredentials,
            challengeType: 'step_up',
            linkedAction: action
        });

        return {
            rpId: result.rpId,
            challenge: result.challenge,
            allowCredentials: result.allowCredentials.map((c) => ({
                id: c.id,
                type: 'public-key' as const,
                transports: c.transports
            }))
        };
    }

    /**
     * Verify the assertion and mint a single-use proof bound to
     * (session, user, action). The plaintext proof is returned to the client;
     * only its hash is stored.
     */
    async finish({
        user,
        sessionTokenHash,
        action,
        assertion
    }: {
        user: User;
        sessionTokenHash: string;
        action: string;
        assertion: WebAuthnAuthenticationResponse;
    }): Promise<StepUpFinishResult> {
        const challengeRecord = await this.repos.passkeyChallenges.findByChallenge(
            assertion.response.clientData.challenge
        );
        if (challengeRecord && challengeRecord.linkedAction !== action) {
            throw new InvalidInputError('Step-up action does not match the challenge it was issued for');
        }

        const existingCredentials = await this.repos.passkeyCredentials.findByUserId(user.id);
        const credential = this.passkeyService.findExistingKey(existingCredentials, assertion.id);

        await this.passkeyService.finishAuthentication({
            userId: user.id,
            assertion,
            credential,
            challengeType: 'step_up'
        });

        const proof = nanoid();
        const expiresAt = new Date(Date.now() + STEP_UP_PROOF_TTL_MS);
        await this.repos.stepUpProofs.create({
            proofHash: StepUpService.hashProof(proof),
            sessionTokenHash,
            userId: user.id,
            action,
            expiresAt
        });

        return { proof, expiresAt };
    }

    /**
     * Atomically validate and consume a proof. Throws StepUpRejected with a
     * specific reason that callers (the guard middleware) can log.
     */
    async consume({
        sessionTokenHash,
        userId,
        action,
        proof
    }: {
        sessionTokenHash: string;
        userId: string;
        action: string;
        proof: string;
    }): Promise<void> {
        const proofHash = StepUpService.hashProof(proof);

        const consumed = await this.repos.stepUpProofs.consume({
            proofHash,
            sessionTokenHash,
            userId,
            action
        });

        if (consumed) return;

        // Proof consume was atomic and failed — look up the row so we can give a
        // more specific failure reason for the audit log.
        const existing = await this.repos.stepUpProofs.findByProofHash(proofHash);
        if (!existing) throw new StepUpRejected('missing');
        if (existing.consumedAt !== null) throw new StepUpRejected('already_consumed');
        if (existing.expiresAt.getTime() <= Date.now()) throw new StepUpRejected('expired');
        if (existing.userId !== userId) throw new StepUpRejected('wrong_user');
        if (existing.sessionTokenHash !== sessionTokenHash) throw new StepUpRejected('wrong_session');
        if (existing.action !== action) throw new StepUpRejected('wrong_action');
        throw new StepUpRejected('missing');
    }
}
