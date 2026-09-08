import { beforeEach, describe, expect } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { OrgPendingAdminsRepository } from './org-pending-admins-repository';
import { OrganizationsRepository } from './organizations-repository';

describe('OrgPendingAdminsRepository', () => {
    let repository: OrgPendingAdminsRepository;
    let orgsRepo: OrganizationsRepository;

    beforeEach<Fixture>(async ({ db }) => {
        repository = new OrgPendingAdminsRepository(db);
        orgsRepo = new OrganizationsRepository(db);
    });

    it('creates a pending admin and finds it by organization and sub', async () => {
        const org = await orgsRepo.create({ name: 'Org One', defaultRoles: [] });

        await repository.create({ organizationId: org.id, oidcSub: 'sub-123' });

        const found = await repository.findByOrganizationAndSub(org.id, 'sub-123');
        expect(found).toEqual(expect.objectContaining({ organizationId: org.id, oidcSub: 'sub-123' }));
    });

    it('returns undefined when no pending admin matches', async () => {
        const org = await orgsRepo.create({ name: 'Org One', defaultRoles: [] });
        expect(await repository.findByOrganizationAndSub(org.id, 'missing')).toBeUndefined();
    });

    it('deletes a pending admin (consumed on bootstrap)', async () => {
        const org = await orgsRepo.create({ name: 'Org One', defaultRoles: [] });
        const created = await repository.create({ organizationId: org.id, oidcSub: 'sub-123' });

        await repository.deleteById(created.id);

        expect(await repository.findByOrganizationAndSub(org.id, 'sub-123')).toBeUndefined();
    });

    it('rejects a duplicate (organization, sub) pair', async () => {
        const org = await orgsRepo.create({ name: 'Org One', defaultRoles: [] });
        await repository.create({ organizationId: org.id, oidcSub: 'sub-123' });

        await expect(repository.create({ organizationId: org.id, oidcSub: 'sub-123' })).rejects.toThrow();
    });
});
