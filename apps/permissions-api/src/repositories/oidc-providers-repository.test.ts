import { beforeEach, describe, expect } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { OidcProvidersRepository } from './oidc-providers-repository';
import { OrganizationsRepository } from './organizations-repository';

describe('OidcProvidersRepository', () => {
    let repository: OidcProvidersRepository;
    let orgsRepo: OrganizationsRepository;

    beforeEach<Fixture>(async ({ db }) => {
        repository = new OidcProvidersRepository(db);
        orgsRepo = new OrganizationsRepository(db);
    });

    it('creates a provider and fetches it by organization', async () => {
        const org = await orgsRepo.create({ name: 'Org One', defaultRoles: [] });

        const created = await repository.create({
            organizationId: org.id,
            issuer: 'https://idp.example.com/',
            jwksUri: 'https://idp.example.com/jwks',
            audience: 'aud-1',
            clientId: 'client-1',
            displayName: 'Example IdP'
        });

        expect(created.issuer).toBe('https://idp.example.com/');

        const fetched = await repository.findById(org.id);
        expect(fetched).toEqual(
            expect.objectContaining({
                organizationId: org.id,
                clientId: 'client-1',
                issuer: 'https://idp.example.com/'
            })
        );
    });

    it('fetches a provider by issuer', async () => {
        const org = await orgsRepo.create({ name: 'Org One', defaultRoles: [] });
        await repository.create({
            organizationId: org.id,
            issuer: 'https://issuer.test/',
            jwksUri: 'https://issuer.test/jwks',
            audience: 'aud',
            clientId: 'client'
        });

        const fetched = await repository.getByIssuer('https://issuer.test/');
        expect(fetched?.organizationId).toBe(org.id);
    });

    it('returns undefined for an unknown organization or issuer', async () => {
        expect(await repository.findById('does-not-exist')).toBeUndefined();
        expect(await repository.getByIssuer('https://unknown/')).toBeUndefined();
    });

    it('stops resolving a provider by issuer once its organization is soft-deleted', async () => {
        const org = await orgsRepo.create({ name: 'Org One', defaultRoles: [] });
        await repository.create({
            organizationId: org.id,
            issuer: 'https://soft.test/',
            jwksUri: 'https://soft.test/jwks',
            audience: 'aud',
            clientId: 'client'
        });

        expect(await repository.getByIssuer('https://soft.test/')).toBeDefined();

        await orgsRepo.delete(org.id);

        expect(await repository.getByIssuer('https://soft.test/')).toBeUndefined();
    });

    it('rejects a duplicate issuer across organizations', async () => {
        const org1 = await orgsRepo.create({ name: 'Org One', defaultRoles: [] });
        const org2 = await orgsRepo.create({ name: 'Org Two', defaultRoles: [] });
        await repository.create({
            organizationId: org1.id,
            issuer: 'https://dup.test/',
            jwksUri: 'https://dup.test/jwks',
            audience: 'aud',
            clientId: 'client'
        });

        await expect(
            repository.create({
                organizationId: org2.id,
                issuer: 'https://dup.test/',
                jwksUri: 'https://dup.test/jwks2',
                audience: 'aud2',
                clientId: 'client2'
            })
        ).rejects.toThrow();
    });
});
