import { z } from 'zod/v4';

export const SessionSchema = z.object({
    id: z.number(),
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
    createdAt: z.date(),
    isCurrent: z.boolean()
});

export const SessionsListSchema = z.object({
    items: z.array(SessionSchema)
});

export const AdminSessionSchema = z.object({
    id: z.number(),
    userId: z.string().nullable(),
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
    createdAt: z.date()
});

export const AdminSessionsListSchema = z.object({
    items: z.array(AdminSessionSchema)
});
