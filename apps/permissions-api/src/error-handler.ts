import { createErrorHandler } from '@repo/api-kit';

export const errorHandler = createErrorHandler({ serviceName: 'permissions-api' });
