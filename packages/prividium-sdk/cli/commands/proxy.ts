import { intro, log } from '@clack/prompts';
import color from 'kleur';
import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { MemoryStorage, SiweAuth, TokenManager } from '#sdk/siwe';
import type { DefCommand } from '../base-cli.js';
import { CreationWorkflow } from '../server/connection-workflow.js';
import { buildServer } from '../server/server.js';
import { showPrividiumHeader } from './utils/show-prividium-header.js';
import { gatherApiUrl, getUserPanelUrl } from './utils/url-config.js';

type Options = {
    apiUrl?: string;
    userPanelUrl?: string;
    privateKey?: string;
    configPath?: string;
    port: number;
    host: string;
    allowExternalAccess: boolean;
};

const DEFAULT_PORT = 24101;
const PRIVATE_KEY_REGEX = /^0x[0-9a-fA-F]{64}$/;

function checkHostAndPortWarnings(host: string, port: number, allowExternalAccess: boolean): void {
    if (port !== DEFAULT_PORT) {
        log.warn(`Non standard port detected: ${port}. Redirect from prividium auth might not work.`);
    }

    if (host !== '127.0.0.1' && host !== 'localhost') {
        if (!allowExternalAccess) {
            log.error(
                `${color.bold('ERROR')}: In order to use a host different than local host you need to set --unsecureAllowOutsideAccess flag.`
            );
            process.exit(1);
        }
        if (host === '0.0.0.0') {
            log.warn(`${color.bold('WARNING')}: Your local proxy will be exposed outside your current device.`);
        } else {
            log.warn(
                `${color.bold('WARNING')}: Non standard host: ${host}. Your proxy might be open for other devices. Redirect from prividium auth might not work.`
            );
        }
    }
}

async function startServerWithPrivateKey(opts: Options): Promise<void> {
    const privateKey = opts.privateKey as Hex;
    if (!PRIVATE_KEY_REGEX.test(privateKey)) {
        log.error('Invalid private key format. Expected 0x-prefixed 32-byte hex string.');
        process.exit(1);
    }

    const account = privateKeyToAccount(privateKey);

    showPrividiumHeader();
    intro('Starting Prividium™ proxy (private key auth)');

    const apiUrl = await gatherApiUrl({
        configPath: opts.configPath,
        apiUrl: opts.apiUrl,
        logProvidedUrls: true
    });

    checkHostAndPortWarnings(opts.host, opts.port, opts.allowExternalAccess);

    const storage = new MemoryStorage();
    const tokenManager = new TokenManager(storage, 0, apiUrl);
    const siweAuth = new SiweAuth({
        account,
        prividiumApiBaseUrl: apiUrl,
        tokenManager
    });

    log.info(`Authenticating as ${account.address}...`);
    const tokenData = await siweAuth.authorize();
    log.info('Authentication successful');

    const app = buildServer({
        apiUrl,

        host: opts.host,
        port: opts.port,
        initialToken: {
            accessToken: tokenData.rawToken,
            expiresAt: tokenData.expiresAt
        },
        async onReAuth() {
            log.info('Session expired, re-authenticating...');
            const newToken = await siweAuth.authorize();
            log.info('Re-authentication successful');
            return { accessToken: newToken.rawToken, expiresAt: newToken.expiresAt };
        },
        async onSubmit() {},
        onCall(methodName) {
            log.message(methodName);
        },
        onReAuthNeeded() {},
        onError(err: Error) {
            log.error(`Error: ${err.message}`);
        }
    });

    await app.listen({
        port: opts.port,
        host: opts.host
    });

    const serverUrl = `http://${opts.host}:${opts.port}`;
    log.info(`Your proxy rpc is ready: \n\n${color.bold(serverUrl)}\n`);
    log.info('Waiting for logs...');
}

async function startServer(opts: Options): Promise<void> {
    const workflow = new CreationWorkflow(opts.host, opts.port);
    workflow.start();

    const apiUrl = await gatherApiUrl({
        configPath: opts.configPath,
        apiUrl: opts.apiUrl,
        logProvidedUrls: true
    });

    const userPanelUrl = await getUserPanelUrl(opts.userPanelUrl, apiUrl);

    checkHostAndPortWarnings(opts.host, opts.port, opts.allowExternalAccess);

    const serverUrl = `http://${opts.host}:${opts.port}`;

    const app = buildServer({
        apiUrl,
        userPanelUrl,
        host: opts.host,
        port: opts.port,
        async onSubmit() {
            await workflow.onSubmit();
        },
        onCall(methodName) {
            workflow.onMessage(methodName);
        },
        onReAuthNeeded() {
            workflow.onMessage(`Please login again: ${serverUrl}`);
        },
        onError: (err: Error) => {
            workflow.onError(err);
        }
    });

    await app.listen({
        port: opts.port,
        host: opts.host
    });

    await workflow.waitForAuthentication(serverUrl);
}

export const addProxy: DefCommand = (cli) => {
    return cli.command(
        'proxy',
        'Starts authenticated rpc proxy server',
        (yargs) =>
            yargs
                .option('apiUrl', {
                    alias: ['api-url', 'rpc-url', 'r'],
                    description:
                        'Specifies target Prividium™ API url. The User Panel url is fetched from /.well-known/prividium on this host.',
                    demandOption: false,
                    type: 'string'
                })
                .option('userPanelUrl', {
                    alias: ['user-panel-url', 'u'],
                    description:
                        'Specifies the User Panel url for browser-based login. When provided, this value takes priority and the User Panel url is not fetched from /.well-known/prividium.',
                    demandOption: false,
                    deprecated: 'fetched automatically from Prividium™ API.',
                    type: 'string'
                })
                .option('configPath', {
                    alias: ['c', 'config-path', 'config'],
                    description: 'Path for config file. By default config file is stored under user personal folder',
                    type: 'string',
                    demandOption: false
                })
                .option('port', {
                    alias: ['p'],
                    description:
                        'Port used for local proxy. This has to match with the port configured in your Prividium™ network.',
                    default: DEFAULT_PORT,
                    type: 'number'
                })
                .option('host', {
                    alias: 'h',
                    description: 'Host used for local server. By default traffic from outside localhost is disabled.',
                    default: '127.0.0.1',
                    type: 'string'
                })
                .option('unsecureAllowOutsideAccess', {
                    alias: ['unsecure-allow-outside-access'],
                    description: 'Allow server to be exposed to the network (accessible by other devices)',
                    default: false,
                    type: 'boolean'
                })
                .option('privateKey', {
                    alias: ['private-key'],
                    description:
                        'Ethereum private key for SIWE authentication (skips browser login). Can also be set via PRIVIDIUM_PRIVATE_KEY env var.',
                    type: 'string'
                }),

        async (args) => {
            try {
                const privateKey = args.privateKey ?? process.env.PRIVIDIUM_PRIVATE_KEY;
                const rpcUrlEnv = process.env.PRIVIDIUM_RPC_URL;
                const apiUrl =
                    args.apiUrl ??
                    process.env.PRIVIDIUM_API_URL ??
                    (rpcUrlEnv ? rpcUrlEnv.replace(/\/rpc\/?$/, '') : undefined);
                const opts: Options = {
                    apiUrl,
                    userPanelUrl: args.userPanelUrl,
                    privateKey,
                    configPath: args.configPath,
                    port: args.port,
                    host: args.host,
                    allowExternalAccess: args.unsecureAllowOutsideAccess
                };

                if (privateKey) {
                    await startServerWithPrivateKey(opts);
                } else {
                    await startServer(opts);
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.error(`Prividium proxy failed: ${message}`);
                process.exit(1);
            }
        }
    );
};
