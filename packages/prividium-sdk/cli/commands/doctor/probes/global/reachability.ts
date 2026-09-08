import * as net from 'node:net';
import { requireHttpOk } from '../../clients/http.js';
import { requireRpcResult } from '../../clients/rpc.js';
import { DEFAULT_DOCTOR_CALLBACK_PORT } from '../../constants.js';
import type { DoctorContext, ProbeOutput } from '../../types.js';
import { getRawReason } from '../../utils.js';

export async function runCallbackPortProbe(): Promise<void> {
    const available = await new Promise<boolean>((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => server.close(() => resolve(true)));
        server.listen(DEFAULT_DOCTOR_CALLBACK_PORT, '127.0.0.1');
    });
    if (!available) {
        throw new Error(
            `Port ${DEFAULT_DOCTOR_CALLBACK_PORT} is already in use. Stop Prividium™ Proxy or other conflicting process before running doctor`
        );
    }
}

export async function runUserPanelReachabilityProbe(context: DoctorContext): Promise<void> {
    await requireHttpOk(new URL('/health', context.targets!.userPanelBaseUrl));
}

export async function runApiHealthProbe(context: DoctorContext): Promise<ProbeOutput> {
    const healthResponse = await fetch(new URL('/health', context.targets!.apiBaseUrl));
    if (!healthResponse.ok) {
        const reason = getRawReason(healthResponse.status, await healthResponse.text());
        throw new Error(reason);
    }
    await requireHttpOk(new URL('/readyz', context.targets!.apiBaseUrl));

    const body = (await healthResponse.json()) as { version?: string };
    if (body.version) {
        context.apiVersion = body.version;
    }

    return {};
}

export async function runPublicRpcProbe(context: DoctorContext): Promise<ProbeOutput> {
    const version = await requireRpcResult(context.targets!.apiBaseUrl, { method: 'web3_clientVersion' });

    return {
        values: [{ label: 'blockNumber', value: version, inline: true }]
    };
}
