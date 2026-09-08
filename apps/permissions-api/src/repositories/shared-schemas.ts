import { NAME_MAX_LENGTH } from '@repo/access-control';
import { z } from 'zod/v4';

export const nameField = z.string().min(1).max(NAME_MAX_LENGTH);
export const displayNameField = z.string().min(1).max(NAME_MAX_LENGTH);
