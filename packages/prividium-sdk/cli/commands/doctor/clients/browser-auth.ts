import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { confirm, log } from '@clack/prompts';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import open from 'open';
import { z } from 'zod';

const AUTH_BROWSER_TIMEOUT_MS = 30_000;

export async function authenticateInBrowser(userPanelBaseUrl: string, callbackPort: number): Promise<string> {
    const state = randomBytes(20).toString('hex');
    const app = Fastify().withTypeProvider<ZodTypeProvider>();
    app.setValidatorCompiler(validatorCompiler);
    app.register(fastifyStatic, { root: path.join(import.meta.dirname, '..', '..', '..', 'static') });

    let resolveToken!: (token: string) => void;
    let rejectToken!: (err: Error) => void;
    const tokenPromise = new Promise<string>((resolve, reject) => {
        resolveToken = resolve;
        rejectToken = reject;
    });

    app.get('/', async (_req, reply) => {
        reply.header('Cache-Control', 'no-cache');
        return reply.type('text/html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Prividium Doctor</title>
  </head>
  <body>
    <script>
      fetch('/redirect-uri')
        .then((response) => response.text())
        .then((url) => {
          window.location.assign(url);
        })
        .catch((error) => {
          document.body.innerText = error.message;
        });
    </script>
  </body>
</html>`);
    });

    app.get('/redirect-uri', async (_req, reply) => {
        const authUrl = new URL('/auth/authorize', userPanelBaseUrl);
        authUrl.searchParams.set('client_id', 'proxy-cli');
        authUrl.searchParams.set('redirect_uri', `http://localhost:${callbackPort}/callback`);
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('response_type', 'token');

        return reply.send(authUrl.toString());
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
                return reply.status(400).send('invalid state received');
            }

            resolveToken(req.body.token);
            return reply.send('ok');
        }
    );

    app.setErrorHandler((error, _req, reply) => {
        rejectToken(error instanceof Error ? error : new Error(String(error)));
        return reply.status(500).send(error instanceof Error ? error.message : String(error));
    });

    try {
        await app.listen({ host: 'localhost', port: callbackPort });
    } catch (error) {
        await app.close();
        if (error instanceof Error && error.message.includes('EADDRINUSE')) {
            throw new Error(
                `port ${callbackPort} already in use — close other Prividium proxy or doctor instances and retry`
            );
        }
        throw error;
    }

    try {
        const startUrl = `http://localhost:${callbackPort}/`;
        await open(startUrl);
    } catch {
        log.warn(`Browser did not open automatically. Open http://localhost:${callbackPort}/ manually.`);
    }

    const timeoutId = setTimeout(async () => {
        const stillWaiting = await confirm({
            message: 'Browser login is taking a while. Still completing login?'
        });
        if (stillWaiting !== true) {
            rejectToken(new Error('Authentication canceled by user'));
        }
    }, AUTH_BROWSER_TIMEOUT_MS);

    try {
        return await tokenPromise;
    } finally {
        clearTimeout(timeoutId);
        await app.close();
    }
}
