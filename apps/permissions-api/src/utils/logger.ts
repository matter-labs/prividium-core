import pino from 'pino';
import { redactSensitiveUrl } from './redact-url';

const CREDENTIAL_HEADERS = [
    'authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'x-step-up-proof'
];
const SECRET_FIELDS = [
    'password',
    'token',
    'secret',
    'authToken',
    'accessToken',
    'refreshToken',
    'apiKey',
    'privateKey'
];

// A redact wildcard matches exactly one level, so each name is listed at the top level and one below it.
const REDACT_PATHS = [
    ...CREDENTIAL_HEADERS.flatMap((header) => [`headers["${header}"]`, `*.headers["${header}"]`]),
    ...SECRET_FIELDS.flatMap((field) => [field, `*.${field}`])
];

// Matched on the serialized line (JSON escapes included). Userinfo runs to the last `@` before `/?#`, as pg splits it.
const CONNECTION_STRING_USERINFO = /:\/\/[^\s/?#:"\\]*:(?:[^/?#"\\]|\\.)*@/g;
const CONNECTION_STRING_PASSWORD_PARAM = /([?&]password=)(?:[^&#"\\]|\\.)*/g;

export function scrubConnectionStrings(line: string): string {
    return line
        .replace(CONNECTION_STRING_USERINFO, '://[REDACTED]@')
        .replace(CONNECTION_STRING_PASSWORD_PARAM, '$1[REDACTED]');
}

const jsonTransport: pino.LoggerOptions = {
    messageKey: 'message',
    formatters: {
        level: (label) => ({ level: label })
    },
    serializers: {
        url: (url: unknown) => (typeof url === 'string' ? redactSensitiveUrl(url) : url)
    },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    // Covers the message, every field and the error stack alike, which per-key redaction cannot.
    hooks: { streamWrite: scrubConnectionStrings }
};

export function createLogger() {
    return pino(jsonTransport);
}

export const customLogger = (config: pino.LoggerOptions, stream?: pino.DestinationStream) =>
    pino({ ...jsonTransport, ...config }, stream);

export type PinoLogger = pino.Logger;
