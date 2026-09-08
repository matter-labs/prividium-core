import pino from 'pino';
import { redactSensitiveUrl } from './redact-url';

const jsonTransport: pino.LoggerOptions = {
    messageKey: 'message',
    formatters: {
        level: (label) => ({ level: label })
    },
    serializers: {
        url: (url: unknown) => (typeof url === 'string' ? redactSensitiveUrl(url) : url)
    }
};

export function createLogger() {
    return pino(jsonTransport);
}

export const customLogger = (config: pino.LoggerOptions, stream?: pino.DestinationStream) =>
    pino({ ...jsonTransport, ...config }, stream);

export type PinoLogger = pino.Logger;
