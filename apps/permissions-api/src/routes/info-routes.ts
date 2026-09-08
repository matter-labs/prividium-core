import type { FastifyServer } from '../build-app';
import { InfoSchema } from './schemas/info';

type Deps = {
    policyEnabled: boolean;
    features: readonly string[];
    multiOrgEnabled: boolean;
    orgRoutingByDomain: boolean;
};

// Stamped by trusted ingress from the serving domain; selects pre-auth branding/IdP discovery only,
// never authorization. Malformed or forged values degrade to null (zone) rather than 400.
const ORG_ID_HEADER = 'x-org-id';
const ORG_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export function infoRoutes(server: FastifyServer, deps: Deps) {
    server.get(
        '/',
        {
            schema: {
                description:
                    'Server-side info / feature flags consumed by admin/user panels at load time. orgId is the ' +
                    'org bound to the serving domain (ingress-stamped X-Org-Id header); null = zone.',
                tags: ['info'],
                response: {
                    200: InfoSchema
                }
            }
        },
        async (req, reply) => {
            const header = deps.multiOrgEnabled ? req.headers[ORG_ID_HEADER] : undefined;
            reply.header('Cache-Control', 'no-store, private');
            return reply.send({
                policyEnabled: deps.policyEnabled,
                features: [...deps.features],
                multiOrgEnabled: deps.multiOrgEnabled,
                orgRoutingByDomain: deps.orgRoutingByDomain,
                orgId: typeof header === 'string' && ORG_ID_PATTERN.test(header) ? header : null
            });
        }
    );
}
