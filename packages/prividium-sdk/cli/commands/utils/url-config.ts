import { confirm, log, text } from '@clack/prompts';
import { z } from 'zod';
import { fetchPrividiumConfig } from '#sdk';
import { ConfigFile } from '../../server/config-file.js';

const envSchema = z.object({
    PRIVIDIUM_API_URL: z.string().optional(),
    PRIVIDIUM_RPC_URL: z.string().optional()
});

type GatherApiUrlOptions = {
    configPath?: string;
    apiUrl?: string;
    logProvidedUrls?: boolean;
};

async function askForUrl(
    maybeUrl: string | undefined,
    name: string,
    logProvidedUrls: boolean
): Promise<{ url: string; prompted: boolean }> {
    if (maybeUrl !== undefined) {
        const res = z.url().safeParse(maybeUrl);
        if (!res.success) {
            throw new Error(`Invalid ${name} url provided: ${maybeUrl}`);
        }

        if (logProvidedUrls) {
            log.info(`Using ${name} url: ${maybeUrl}`);
        }

        return { url: maybeUrl, prompted: false };
    }

    const url = await text({
        message: `Please insert your ${name} url`,
        validate(value) {
            const parsed = z.url().safeParse(value);
            if (!parsed.success) {
                return 'Please provide a valid url';
            }
        }
    });

    if (typeof url === 'symbol') {
        throw new Error('Canceled by the user');
    }

    return { url, prompted: true };
}

export async function gatherApiUrl({
    configPath,
    apiUrl,
    logProvidedUrls = false
}: GatherApiUrlOptions): Promise<string> {
    const config = new ConfigFile(configPath);
    const configData = config.read();
    const env = envSchema.parse(process.env);

    const givenApiUrl = apiUrl ?? env.PRIVIDIUM_API_URL ?? env.PRIVIDIUM_RPC_URL ?? configData.apiUrl;
    const { url: resolvedApiUrl, prompted } = await askForUrl(givenApiUrl, 'Prividium™ API', logProvidedUrls);

    if (prompted) {
        const confirmation = await confirm({
            message: 'Do you want to store this config for future usages?'
        });

        if (confirmation) {
            config.write({ apiUrl: resolvedApiUrl });
        }
    }

    return resolvedApiUrl;
}

export async function getUserPanelUrl(userInput: string | undefined, apiUrl: string): Promise<string> {
    let userPanelUrl: string;
    if (userInput !== undefined) {
        const parsed = z.url().safeParse(userInput);
        if (!parsed.success) {
            throw new Error(`Invalid User Panel url provided: ${userInput}`);
        }
        userPanelUrl = parsed.data;
    } else {
        log.info('Fetching configuration from Prividium™ API...');
        const prividiumInfo = await fetchPrividiumConfig(apiUrl);
        userPanelUrl = prividiumInfo.userPanelUrl;
    }
    log.info(`Using User Panel url: ${userPanelUrl}`);
    return userPanelUrl;
}
