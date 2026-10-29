import { z } from 'zod/v4';
import type { FastifyServer } from '#build-app';
import { addressSchema } from '#utils/schemas/address';
import { hexSchema } from '#utils/schemas/hex-schema';

const wellKnownFileSchema = z.object({
    v1: z.object({
        blockExplorerUrl: z.url(),
        chainId: hexSchema,
        chainName: z.string(),
        baseToken: z.object({
            name: z.string(),
            symbol: z.string(),
            decimals: z.number(),
            l1Address: addressSchema.nullable()
        }),
        rpcUrl: z.url(),
        userPanelUrl: z.url(),
        version: z.string(),
        l1ChainId: hexSchema.nullable(),
        l1ChainName: z.string().nullable(),
        // Which wallets the user panel features in its connect picker (EIP-6963 rdns values).
        // Absent means "feature the panel's full wallet registry". Keep in lockstep with the SDK's
        // prividiumSystemInfoSchema — the response is serialized strictly against THIS schema, so a
        // field missing here is silently stripped from the wire.
        featuredWalletIds: z.string().array().optional()
    })
});
export type PrividiumInfo = z.infer<typeof wellKnownFileSchema>['v1'];

// RFC 9116 requires Expires; scanners flag an expired file. Bump it at the CVD policy's annual review.
const SECURITY_TXT = [
    '# Matter Labs / Prividium Coordinated Vulnerability Disclosure',
    '# https://www.rfc-editor.org/rfc/rfc9116',
    '',
    'Contact: mailto:security@matterlabs.dev',
    'Expires: 2027-09-01T00:00:00.000Z',
    'Preferred-Languages: en',
    'Policy: https://www.zksync.io/prividium/security',
    ''
].join('\n');

type Deps = { prividiumInfo: PrividiumInfo };
export function dotWellKnownRoutes(server: FastifyServer, deps: Deps) {
    server.get(
        '/prividium',
        {
            schema: {
                response: {
                    200: wellKnownFileSchema
                }
            }
        },
        async (_req, reply) => {
            return reply.send({ v1: deps.prividiumInfo });
        }
    );

    server.get(
        '/security.txt',
        {
            schema: {
                response: {
                    200: z.string()
                }
            }
        },
        async (_req, reply) => {
            return reply.type('text/plain; charset=utf-8').send(SECURITY_TXT);
        }
    );
}
