import type { Repositories } from '../db';
import type {
    InsertM2mApplication,
    M2mApplication,
    UpdateOrgM2mApplication
} from '../repositories/m2m-applications-repository';

type M2mTarget = { appId: string; organizationId?: string };

function applicationAuditDetails(app: M2mApplication) {
    return {
        resourceType: 'm2m-app' as const,
        resourceId: app.id,
        affectedOrganizationIds:
            app.ownerOrganizationId !== null ? [app.ownerOrganizationId] : app.organizations.map((org) => org.id)
    };
}

export async function createAuditedM2mApplication(
    repos: Repositories,
    data: InsertM2mApplication,
    organizationId?: string
) {
    const app =
        organizationId === undefined
            ? await repos.m2mApps.create(data)
            : await repos.m2mApps.createForOrg(organizationId, data);
    return { app, auditEventDetails: applicationAuditDetails(app) };
}

export async function updateAuditedM2mApplication(
    repos: Repositories,
    target: M2mTarget,
    data: UpdateOrgM2mApplication
) {
    return repos.transaction(async (tx) => {
        const apps = tx.repositories().m2mApps;
        await apps.lockById(target.appId, target.organizationId);
        const app =
            target.organizationId === undefined
                ? await apps.update(target.appId, data)
                : await apps.updateForOrg(target.organizationId, target.appId, data);
        const organizations = await apps.getOrganizations(app.id);
        return { app, auditEventDetails: applicationAuditDetails({ ...app, organizations }) };
    });
}

export async function deleteAuditedM2mApplication(repos: Repositories, target: M2mTarget) {
    return repos.transaction(async (tx) => {
        const apps = tx.repositories().m2mApps;
        await apps.lockById(target.appId, target.organizationId);
        const app = await apps.getById(target.appId);
        const organizations = await apps.getOrganizations(app.id);
        if (target.organizationId === undefined) {
            await apps.delete(target.appId);
        } else {
            await apps.deleteForOrg(target.organizationId, target.appId);
        }
        return applicationAuditDetails({ ...app, organizations });
    });
}

export async function replaceAuditedM2mOrganizations(repos: Repositories, appId: string, organizationIds: string[]) {
    return repos.transaction(async (tx) => {
        const apps = tx.repositories().m2mApps;
        await apps.lockById(appId);
        const app = await apps.getById(appId);
        const previousOrganizations = await apps.getOrganizations(appId);
        const organizations = await apps.replaceOrganizations(appId, organizationIds);
        const before = new Set(previousOrganizations.map((org) => org.id));
        const after = new Set(organizations.map((org) => org.id));
        const organizationLinkChanges = Object.fromEntries([
            ...[...before].filter((id) => !after.has(id)).map((id) => [id, 'removed'] as const),
            ...[...after].filter((id) => !before.has(id)).map((id) => [id, 'added'] as const)
        ]);
        return {
            organizations,
            auditEventDetails: {
                resourceType: 'm2m-app' as const,
                resourceId: app.id,
                affectedOrganizationIds: [
                    ...new Set([
                        ...(app.ownerOrganizationId === null ? [] : [app.ownerOrganizationId]),
                        ...Object.keys(organizationLinkChanges)
                    ])
                ],
                actionDetails: { organizationLinkChanges }
            }
        };
    });
}
