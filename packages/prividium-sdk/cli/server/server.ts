import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { log } from '@clack/prompts';
import { type FastifyHttpProxyOptions, fastifyHttpProxy } from '@fastify/http-proxy';
import fastifyStatic from '@fastify/static';
import { addYears } from 'date-fns/addYears';
import Fastify from 'fastify';
import { validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

function fastifyApp() {
    return Fastify().withTypeProvider<ZodTypeProvider>();
}

type WebServer = ReturnType<typeof fastifyApp>;

type Config = {
    apiUrl: string;
    userPanelUrl?: string;
    host: string;
    port: number;
    onSubmit: () => Promise<void>;
    onCall: (methodName: string) => void;
    onReAuthNeeded: () => void;
    onError: (err: Error) => void;
    initialToken?: { accessToken: string; expiresAt: Date };
    onReAuth?: () => Promise<{ accessToken: string; expiresAt: Date }>;
};

function randomStateString(): string {
    return randomBytes(20).toString('hex');
}

const rpcCallSchema = z.object({ method: z.string() });
const rpcReqSchema = z.union([rpcCallSchema, rpcCallSchema.array()]);

export const sessionSchema = z.object({
    type: z.string(),
    expiresAt: z.coerce.date()
});

export function buildServer(config: Config): WebServer {
    const app = fastifyApp();

    const validHosts =
        config.host === 'localhost' || config.host === '127.0.0.1' ? ['localhost', '127.0.0.1'] : [config.host];

    app.setValidatorCompiler(validatorCompiler);

    app.setErrorHandler((err: Error, _req, reply) => {
        config.onError(err);
        console.error(err);
        return reply.status(500).send({ error: err.message });
    });

    const state = randomStateString();
    let accessToken = config.initialToken?.accessToken ?? '';
    let expiresAt: Date = config.initialToken?.expiresAt ?? new Date();
    let reauthPromise: Promise<{ accessToken: string; expiresAt: Date }> | null = null;

    app.register(fastifyStatic, { root: path.join(import.meta.dirname, '..', 'static') });

    app.get('/health', async (_req, reply) => {
        return reply.send('ok');
    });

    app.get('/', async (_req, reply) => {
        reply.header('Cache-Control', 'no-cache');
        return reply.sendFile(path.join('start.html'));
    });

    app.get('/redirect-uri', async (_req, reply) => {
        const url = new URL('/auth/authorize', config.userPanelUrl ?? config.apiUrl);
        url.searchParams.set('client_id', 'proxy-cli');
        url.searchParams.set('redirect_uri', `http://localhost:24101/callback`);
        url.searchParams.set('state', state);
        url.searchParams.set('response_type', 'token');

        return reply.send(url.toString());
    });

    app.get('/callback', async (_req, reply) => {
        reply.header('Cache-Control', 'no-cache');
        return reply.sendFile(path.join('callback.html'));
    });

    app.post(
        '/submit',
        {
            schema: {
                body: z.object({
                    token: z.string(),
                    state: z.string()
                })
            }
        },
        async (req, reply) => {
            if (req.body.state !== state) {
                throw new Error('invalid state received');
            }

            const { expiresAt: expirationMoment } = await fetch(new URL('/api/auth/current-session', config.apiUrl), {
                method: 'GET',
                headers: { authorization: `Bearer ${req.body.token}` }
            }).then((res) => {
                if (res.status === 404) {
                    return Promise.resolve({
                        type: 'user',
                        expiresAt: addYears(new Date(), 100)
                    });
                }

                if (!res.ok || res.status !== 200) {
                    throw new Error('Error interacting with api');
                }

                return res.json().then((json) => sessionSchema.parse(json));
            });

            expiresAt = expirationMoment;
            accessToken = req.body.token;

            await config.onSubmit();

            return reply.send('ok');
        }
    );

    const proxyOptions = (prefix: string): FastifyHttpProxyOptions => ({
        upstream: config.apiUrl,
        prefix,
        rewritePrefix: '/rpc',
        httpMethods: ['POST'],
        preValidation: async (request) => {
            const method = rpcReqSchema.safeParse(request.body);

            if (new Date() > expiresAt) {
                if (config.onReAuth) {
                    try {
                        if (!reauthPromise) {
                            reauthPromise = config.onReAuth().finally(() => {
                                reauthPromise = null;
                            });
                        }
                        const newToken = await reauthPromise;
                        accessToken = newToken.accessToken;
                        expiresAt = newToken.expiresAt;
                    } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        config.onError(new Error(`Re-authentication failed: ${msg}`));
                        throw new Error('Session expired and re-authentication failed. Please restart the proxy.');
                    }
                } else {
                    config.onReAuthNeeded();
                    throw new Error('Token expired');
                }
            }

            if (!method.success) {
                config.onCall('unknown');
            } else if (Array.isArray(method.data)) {
                config.onCall(method.data.map((m) => m.method).join(', '));
            } else {
                config.onCall(method.data.method);
            }
        },
        preHandler: (req, reply, done) => {
            if (accessToken === '') {
                reply.status(500).send('please authenticate first.');
                return;
            }

            const portStr = config.port !== 80 ? `:${config.port}` : '';
            const fullHosts = validHosts.map((host) => `${host}${portStr}`);

            if (req.headers.host && !fullHosts.some((host) => req.headers.host === host)) {
                log.error(`Expected host to by any of ${fullHosts.join(', ')} but got ${req.headers.host}`);
                reply.status(403).send("host doesn't match");
                return;
            }

            return done();
        },
        replyOptions: {
            rewriteRequestHeaders: (_originalReq, headers) => ({
                ...headers,
                authorization: `Bearer ${accessToken}`
            })
        }
    });

    app.register(fastifyHttpProxy, proxyOptions('/'));
    app.register(fastifyHttpProxy, proxyOptions('/rpc'));

    return app;
}
