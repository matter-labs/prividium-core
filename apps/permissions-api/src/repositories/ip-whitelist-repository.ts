import { and, asc, eq } from 'drizzle-orm';
import ipaddr from 'ipaddr.js';
import { apiKeysIpWhitelistTable } from '../db/schema';
import { getFirst } from '../db/utils';
import { isOverbroadCidr } from '../utils/cidr';
import { EntityNotFound, InvalidInputError } from '../utils/error-types';
import type { PaginatedResult, PaginationParams } from '../utils/schemas/pagination';
import { EntityRepository } from './entity-repository';

const IpWhitelistRepositoryBase = EntityRepository({
    table: apiKeysIpWhitelistTable,
    idColumn: apiKeysIpWhitelistTable.id,
    entityName: 'IpWhitelist',
    defaultOrderBy: [asc(apiKeysIpWhitelistTable.createdAt), asc(apiKeysIpWhitelistTable.id)]
});

export type IpWhitelist = typeof apiKeysIpWhitelistTable.$inferSelect;
export type InsertIpWhitelist = typeof apiKeysIpWhitelistTable.$inferInsert;

function isValidIpOrCidr(address: string, allowAnyCidr: boolean): boolean {
    if (ipaddr.isValid(address)) return true;
    try {
        const [addr, prefixLength] = ipaddr.parseCIDR(address);
        if (!allowAnyCidr && isOverbroadCidr(addr, prefixLength)) {
            return false;
        }

        // Reject CIDRs with host bits set (e.g., 10.42.1.5/16 should be 10.42.0.0/16)
        const networkAddr =
            addr.kind() === 'ipv4'
                ? ipaddr.IPv4.networkAddressFromCIDR(address)
                : ipaddr.IPv6.networkAddressFromCIDR(address);
        return addr.toString() === networkAddr.toString();
    } catch {
        return false;
    }
}

export class IpWhitelistRepository extends IpWhitelistRepositoryBase {
    async create(data: InsertIpWhitelist, opts: { allowAnyCidr?: boolean } = {}): Promise<IpWhitelist> {
        // Validate IP or CIDR format
        if (!isValidIpOrCidr(data.ipAddress, opts.allowAnyCidr ?? false)) {
            throw new InvalidInputError(`Invalid IP address or CIDR: ${data.ipAddress}`);
        }

        // Validate unique owner
        if (data.m2mAppId && data.tenantId) {
            throw new InvalidInputError('Exactly one IP whitelist owner must be provided');
        }

        return super.create({
            tenantId: data.tenantId,
            m2mAppId: data.m2mAppId,
            ipAddress: data.ipAddress,
            description: data.description ?? null
        });
    }

    async findByTenantId(tenantId: string, paginationParams: PaginationParams): Promise<PaginatedResult<IpWhitelist>> {
        return this.findPaginated(paginationParams, { filter: eq(apiKeysIpWhitelistTable.tenantId, tenantId) });
    }

    async findByM2mAppId(m2mApp: string, paginationParams: PaginationParams): Promise<PaginatedResult<IpWhitelist>> {
        return this.findPaginated(paginationParams, { filter: eq(apiKeysIpWhitelistTable.m2mAppId, m2mApp) });
    }

    async getAllForTenant(tenantId: string): Promise<string[]> {
        const entries = await this.db.query.apiKeysIpWhitelistTable.findMany({
            where: eq(apiKeysIpWhitelistTable.tenantId, tenantId),
            columns: { ipAddress: true }
        });

        return entries.map((e) => e.ipAddress);
    }

    async getByIdForTenant(id: string, tenantId: string): Promise<IpWhitelist> {
        return this.getById(id, { filter: eq(apiKeysIpWhitelistTable.tenantId, tenantId) });
    }

    async deleteForTenant(id: string, tenantId: string): Promise<void> {
        return this.deleteByOwner(id, apiKeysIpWhitelistTable.tenantId, tenantId);
    }

    async deleteForM2mApp(id: string, m2mAppId: string): Promise<void> {
        return this.deleteByOwner(id, apiKeysIpWhitelistTable.m2mAppId, m2mAppId);
    }

    private async deleteByOwner(
        id: string,
        column: typeof apiKeysIpWhitelistTable.tenantId | typeof apiKeysIpWhitelistTable.m2mAppId,
        ownerId: string
    ): Promise<void> {
        const deleted = await this.db
            .delete(apiKeysIpWhitelistTable)
            .where(and(eq(apiKeysIpWhitelistTable.id, id), eq(column, ownerId)))
            .returning()
            .then(getFirst);

        if (deleted === undefined) {
            throw new EntityNotFound('IpWhitelist', { id });
        }
    }

    async isTenantIpAllowed(tenantId: string, clientIp: string): Promise<boolean> {
        return this.isIpAllowed(apiKeysIpWhitelistTable.tenantId, tenantId, clientIp);
    }

    async isM2mAppIpAllowed(m2mApp: string, clientIp: string): Promise<boolean> {
        return this.isIpAllowed(apiKeysIpWhitelistTable.m2mAppId, m2mApp, clientIp);
    }

    async isIpAllowed(
        column: typeof apiKeysIpWhitelistTable.tenantId | typeof apiKeysIpWhitelistTable.m2mAppId,
        relatedId: string,
        clientIp: string
    ): Promise<boolean> {
        const entries = await this.db.query.apiKeysIpWhitelistTable.findMany({
            where: eq(column, relatedId),
            columns: { ipAddress: true }
        });

        if (entries.length === 0) return false;

        let parsedClient: ipaddr.IPv4 | ipaddr.IPv6;
        try {
            parsedClient = ipaddr.process(clientIp);
        } catch (err) {
            console.error(`Failed to parse client IP "${clientIp}" — rejecting`, err);
            return false;
        }

        return entries.some((entry) => {
            try {
                if (entry.ipAddress.includes('/')) {
                    const cidr = ipaddr.parseCIDR(entry.ipAddress);
                    // ipaddr.match throws on a cross-family comparison.
                    if (cidr[0].kind() !== parsedClient.kind()) return false;
                    return parsedClient.match(cidr);
                }
                return parsedClient.toString() === ipaddr.process(entry.ipAddress).toString();
            } catch (err) {
                console.error(`Corrupt IP whitelist entry skipped: "${entry.ipAddress}"`, err);
                return false;
            }
        });
    }
}
