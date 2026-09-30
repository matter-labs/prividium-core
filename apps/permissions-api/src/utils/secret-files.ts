import { readFileSync } from 'node:fs';

/** Fills each `NAME` from the file `NAME_FILE` points at, trailing newlines trimmed. */
export function readSecretFiles(runtimeEnv: NodeJS.ProcessEnv, names: readonly string[]): NodeJS.ProcessEnv {
    const resolved = { ...runtimeEnv };
    for (const name of names) {
        const file = runtimeEnv[`${name}_FILE`];
        if (!file) {
            continue;
        }
        if (runtimeEnv[name]) {
            throw new Error(`${name} and ${name}_FILE are both set; set only one`);
        }
        let value: string;
        try {
            value = readFileSync(file, 'utf8').replace(/[\r\n]+$/, '');
        } catch (error) {
            throw new Error(`Cannot read ${name}_FILE (${(error as NodeJS.ErrnoException).code ?? 'unknown error'})`);
        }
        if (!value) {
            throw new Error(`${name}_FILE points at an empty file`);
        }
        resolved[name] = value;
    }
    return resolved;
}
