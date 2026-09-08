import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { confirm, log, text } from '@clack/prompts';
import appDirs from 'appdirsjs';
import color from 'kleur';
import { z } from 'zod';

import { hexSchema } from '../commands/utils/schemas.js';

// biome-ignore lint/suspicious/noExplicitAny: CJS/ESM interop
const appDirsFn = ((appDirs as any).default ?? appDirs) as typeof appDirs;
const dirs = appDirsFn({ appName: 'prividium-proxy' });

// Source of truth for the on-disk config-file shapes the SDK accepts.
// `latest` is what `write()` produces today.
// Any other entry is keyed by the last SDK version that wrote that shape;
// it exists only so older config files keep working after a user upgrades.
// To add a new legacy entry: copy the previous `latest` into a new `vX_Y`
// key, then change `latest` to the new shape and add a branch in `migrate()`.
const schemas = {
    latest: z.object({
        apiUrl: z.string().optional(),
        l1RpcUrl: z.string().optional(),
        localZksyncOsRpcUrl: z.string().optional(),
        diamondAddress: z.string().optional()
    }),
    v0_17: z.object({
        prividiumRpcUrl: z.string(),
        userPanelUrl: z.string()
    })
} as const;

const ENV_VARS_FOR_CONFIG = {
    apiUrl: 'PRIVIDIUM_API_URL',
    l1RpcUrl: 'L1_RPC_URL',
    diamondAddress: 'ZSYNCOS_L1_DIAMOND',
    localZksyncOsRpcUrl: 'LOCAL_ZKSYNCOS_RPC_URL'
} as const;

const PROMPTS_FOR_CONFIGS = {
    apiUrl: {
        msg: 'Please insert your Prividium™ api url',
        retry: 'Please provide a valid url',
        schema: z.url()
    },
    diamondAddress: {
        msg: 'Please provide the address of the ZKsync OS main contract in l1',
        retry: 'Please provide a valid address',
        schema: hexSchema
    },
    l1RpcUrl: {
        msg: 'Please provide an rpc url for the l1 chain',
        retry: 'Please provide a valid url',
        schema: z.url()
    },
    localZksyncOsRpcUrl: {
        msg: 'Please provide an url for a local and trusted zksyncos rpc',
        retry: 'Please provide a valid url',
        schema: z.url()
    }
} as const;
type MsgKeys = keyof typeof PROMPTS_FOR_CONFIGS;

export type CliConfig = z.infer<typeof schemas.latest>;

type NoUndefinedFields<T> = { [K in keyof T]-?: Exclude<T[K], undefined> };
type WithUndefinedFields<T> = { [K in keyof T]?: T[K] | null | undefined };

function migrate(json: unknown): CliConfig | null {
    const latest = schemas.latest.safeParse(json);
    if (latest.success) return latest.data;

    const v0_17 = schemas.v0_17.safeParse(json);
    if (v0_17.success) return { apiUrl: v0_17.data.prividiumRpcUrl };

    return null;
}

export class ConfigFile {
    private filePath: string;
    constructor(filePath?: string) {
        if (filePath) {
            this.filePath = filePath;
        } else {
            this.filePath = path.join(dirs.config, 'config.json');
        }
    }

    read(): Partial<CliConfig> {
        if (!existsSync(this.filePath)) {
            return {};
        } else {
            const data = readFileSync(this.filePath).toString();
            try {
                const json = JSON.parse(data);
                return migrate(json) ?? {};
            } catch {
                rmSync(this.filePath);
                log.warn('Corrupted configuration file');
                return {};
            }
        }
    }

    write(config: CliConfig) {
        const dir = path.parse(this.filePath).dir;
        mkdirSync(dir, { recursive: true });
        writeFileSync(this.filePath, JSON.stringify(config));
    }

    partialWrite(newConfig: Partial<CliConfig>) {
        const old = this.read();
        const dir = path.parse(this.filePath).dir;
        mkdirSync(dir, { recursive: true });
        writeFileSync(this.filePath, JSON.stringify({ ...old, ...newConfig }));
    }

    remove() {
        if (existsSync(this.filePath)) {
            rmSync(this.filePath);
        }
    }

    print() {
        const { apiUrl } = this.read();

        console.log(`${color.bold('Prividium™ API url')}: ${apiUrl}`);
    }

    printPath() {
        console.log(this.filePath);
    }

    async readAndUpdatedRequiredFields<K extends keyof CliConfig>(
        given: WithUndefinedFields<Pick<CliConfig, K>>
    ): Promise<NoUndefinedFields<Pick<CliConfig, K>>> {
        const res: Partial<CliConfig> = {};
        const existing = this.read();

        for (const key in given) {
            if (given[key] !== null && given[key] !== undefined) {
                res[key] = given[key];
            } else if (key in existing) {
                res[key] = existing[key];
            } else if (ENV_VARS_FOR_CONFIG[key] && ENV_VARS_FOR_CONFIG[key] in process.env) {
                res[key] = process.env[ENV_VARS_FOR_CONFIG[key]];
            } else {
                res[key] = await this.prompt(key);
            }
        }

        return res as NoUndefinedFields<Pick<CliConfig, K>>;
    }

    async prompt(key: MsgKeys): Promise<string> {
        const response = await text({
            message: PROMPTS_FOR_CONFIGS[key].msg,
            validate(value) {
                const parsed = PROMPTS_FOR_CONFIGS[key].schema.safeParse(value);
                if (!parsed.success) {
                    return PROMPTS_FOR_CONFIGS[key].retry;
                }
            }
        });

        if (typeof response === 'symbol') {
            throw new Error('Canceled by the user');
        }

        const save = await confirm({
            message: 'Do you want to save this value for future usages?',
            initialValue: true
        });

        if (typeof save === 'symbol') {
            throw new Error('Canceled by the user');
        }

        if (save) {
            this.partialWrite({ [key]: response });
        }

        return response;
    }
}
