import { entityRepositoryOn } from '@repo/api-kit';
import { BaseRepository } from './base-repository';

export type { EntityConfig, QueryOptions } from '@repo/api-kit';

/** The base stays local: the transaction augmentor it registers is class-level state,
 * so two apps sharing one class would share that slot. */
export const EntityRepository = entityRepositoryOn(BaseRepository);
