export const ACTOR_TYPES = {
    USER: 'user',
    TENANT: 'tenant',
    SERVICE: 'service',
    SYSTEM: 'system',
    ANONYMOUS: 'anonymous'
} as const;

export type ActorType = (typeof ACTOR_TYPES)[keyof typeof ACTOR_TYPES];

export const ACTOR_TYPE_VALUES = Object.values(ACTOR_TYPES) as [ActorType, ...ActorType[]];
