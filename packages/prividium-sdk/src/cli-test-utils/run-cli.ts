import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { buildCli } from '../../cli/index.js';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, '../..');
const cliEntrypoint = path.join(packageRoot, 'bin/cli.js');

class ExitError extends Error {
    constructor(public readonly code: number) {
        super(`process.exit(${code})`);
    }
}

export type RunCliResult = {
    exitCode: number | null;
    stdout: string;
    stderr: string;
};

/**
 * Spawn the compiled `bin/cli.js` as a subprocess. Use this for smoke-testing
 * that the shipped binary actually loads end-to-end (module resolution,
 * top-level imports, `bin` entry). Requires `buildCliPackage()` to have run.
 */
export async function spawnCli(args: string[]): Promise<RunCliResult> {
    return await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cliEntrypoint, ...args], {
            cwd: packageRoot,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
    });
}

export async function buildCliPackage(): Promise<void> {
    await execFileAsync('pnpm', ['build'], { cwd: packageRoot, env: process.env });
}

export async function runCli(args: string[]): Promise<RunCliResult> {
    let stdout = '';
    let stderr = '';

    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    const originalExit = process.exit;
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    const originalIsTTY = process.stdout.isTTY;

    // Force @clack/prompts to fall back to plain, non-interactive rendering.
    process.stdout.isTTY = false;

    process.stdout.write = ((chunk: unknown) => {
        stdout += typeof chunk === 'string' ? chunk : String(chunk);
        return true;
    }) as typeof process.stdout.write;

    process.stderr.write = ((chunk: unknown) => {
        stderr += typeof chunk === 'string' ? chunk : String(chunk);
        return true;
    }) as typeof process.stderr.write;

    // Vitest intercepts console.* before it reaches process.stdout/stderr, so we
    // mock those too to capture yargs' help output and any direct console usage.
    console.log = (...parts: unknown[]) => {
        stdout += `${parts.map((p) => (typeof p === 'string' ? p : String(p))).join(' ')}\n`;
    };
    console.error = (...parts: unknown[]) => {
        stderr += `${parts.map((p) => (typeof p === 'string' ? p : String(p))).join(' ')}\n`;
    };

    process.exit = ((code?: number): never => {
        throw new ExitError(code ?? 0);
    }) as typeof process.exit;

    let exitCode = 0;
    try {
        await buildCli().parseAsync(args);
    } catch (e) {
        if (e instanceof ExitError) {
            exitCode = e.code;
        } else {
            throw e;
        }
    } finally {
        process.stdout.write = originalStdoutWrite;
        process.stderr.write = originalStderrWrite;
        process.exit = originalExit;
        console.log = originalConsoleLog;
        console.error = originalConsoleError;
        process.stdout.isTTY = originalIsTTY;
    }

    return { exitCode, stdout, stderr };
}
