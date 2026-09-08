import pino from 'pino';

// Log with format more appropiate to a script.
export const scriptLogger = pino({
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
            ignore: 'pid,hostname'
        }
    }
});
