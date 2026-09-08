import { timestamp as pgTimestamp, text } from 'drizzle-orm/pg-core';
import { nanoid } from 'nanoid';

export const timestampTz = (name?: string) =>
    name ? pgTimestamp(name, { withTimezone: true }) : pgTimestamp({ withTimezone: true });

export const createdAt = timestampTz().notNull().defaultNow();

export const updatedAt = timestampTz()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const publicId = text()
    .primaryKey()
    .$default(() => nanoid());
