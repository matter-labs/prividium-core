import { NAME_MAX_LENGTH } from '@repo/access-control';
import { Abi } from 'abitype/zod';
import { and, count, desc, eq, ilike, inArray, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm';
import type { Address, Hex } from 'viem';
import { z } from 'zod/v4';
import type { DbOrTx } from '../db';
import { contractsTable, contractTemplatesTable, disclosedAddressesTable, organizationsTable } from '../db/schema';
import { escapeLike } from '../db/utils';
import { EntityAlreadyExistsError, EntityNotFound, InvalidInputError, UnexpectedDbError } from '../utils/error-types';
import { fetchChunked } from '../utils/fetch-chunked';
import { hexSchema } from '../utils/schemas/hex-schema';
import type { PaginatedResult } from '../utils/schemas/pagination';
import { BaseRepository } from './base-repository';

const disclosedAddressListSchema = z.array(z.object({ address: hexSchema }));
type DisclosedAddressList = z.infer<typeof disclosedAddressListSchema>;

export const fullContractSchema = z.object({
    contractAddress: hexSchema,
    abi: z.string().min(1, 'ABI cannot be empty'),
    name: z.string().max(NAME_MAX_LENGTH).nullable(),
    description: z.string().nullable(),
    discloseErc20TotalSupply: z.boolean(),
    discloseBytecode: z.boolean(),
    templateId: z.number().int().nullable(),
    isSystemContract: z.boolean(),
    // null = zone-level contract (shared across all orgs); non-null = owned by that organization
    organizationId: z.string().nullable(),
    disclosedAddresses: disclosedAddressListSchema,
    createdAt: z.date(),
    updatedAt: z.date(),
    disclosureStartBlock: hexSchema
});

const contractWriteSchema = z.object({
    ...fullContractSchema.omit({
        createdAt: true,
        updatedAt: true,
        templateId: true,
        isSystemContract: true,
        // Owner organization is set at creation and immutable afterwards.
        organizationId: true,
        disclosureStartBlock: true
    }).shape,
    templateId: z.number().int().nullable().optional(),
    templateKey: z.string().nullable().optional(), // Alternative way to specify template (resolved to id)
    disclosedAddresses: disclosedAddressListSchema.optional(),
    disclosureStartBlock: hexSchema
});

export const createContractSchema = contractWriteSchema.extend({
    discloseErc20TotalSupply: z.boolean().default(false),
    discloseBytecode: z.boolean().default(false),
    disclosedAddresses: disclosedAddressListSchema.default([]),
    // Owner organization (operator-chosen). Omit or null for a zone-level contract.
    organizationId: z.string().nullable().optional()
});

export const updateContractSchema = contractWriteSchema;

export type Contract = z.infer<typeof fullContractSchema>;
export type ContractCreate = z.input<typeof createContractSchema>;
export type ContractUpdate = z.input<typeof updateContractSchema>;

export type BytecodeDisclosureConfig = { disclosureStartBlock: Hex };

// Schema for contract group item (template with contract count)
export const contractGroupItemSchema = z.object({
    type: z.literal('group'),
    templateId: z.number().int(),
    templateKey: z.string(),
    templateName: z.string(),
    templateDescription: z.string().nullable(),
    contractCount: z.number().int().positive(),
    matchingContractsCount: z.number().int().nonnegative().optional()
});

// Schema for ungrouped contract item
export const ungroupedContractSchema = fullContractSchema.extend({
    type: z.literal('contract')
});

// Union type for grouped response items
export const groupedContractItemSchema = z.discriminatedUnion('type', [
    contractGroupItemSchema,
    ungroupedContractSchema
]);

export type ContractGroupItem = z.infer<typeof contractGroupItemSchema>;
export type UngroupedContract = z.infer<typeof ungroupedContractSchema>;
export type GroupedContractItem = z.infer<typeof groupedContractItemSchema>;

// Response schema for grouped contracts endpoint
export const groupedContractsResponseSchema = z.object({
    items: z.array(groupedContractItemSchema),
    pagination: z.object({
        currentPage: z.number().int().positive(),
        totalPages: z.number().int().nonnegative(),
        totalItems: z.number().int().nonnegative(),
        limit: z.number().int().positive(),
        offset: z.number().int().nonnegative()
    }),
    totalGroups: z.number().int().nonnegative(),
    totalUngrouped: z.number().int().nonnegative(),
    totalContracts: z.number().int().nonnegative()
});

export type GroupedContractsResponse = z.infer<typeof groupedContractsResponseSchema>;

// Response schema for contracts by template endpoint
export const contractsByTemplateResponseSchema = z.object({
    items: z.array(fullContractSchema),
    pagination: z.object({
        currentPage: z.number().int().positive(),
        totalPages: z.number().int().nonnegative(),
        totalItems: z.number().int().nonnegative(),
        limit: z.number().int().positive(),
        offset: z.number().int().nonnegative()
    }),
    template: z.object({
        id: z.number().int(),
        templateKey: z.string(),
        name: z.string(),
        description: z.string().nullable()
    })
});

export type ContractsByTemplateResponse = z.infer<typeof contractsByTemplateResponseSchema>;

export class ContractsRepository extends BaseRepository {
    /**
     * Find contracts grouped by template
     * Returns template groups (sorted by count desc) followed by ungrouped contracts
     */
    async findGrouped({
        limit,
        offset,
        searchQuery,
        organizationId
    }: {
        limit: number;
        offset: number;
        searchQuery?: string;
        organizationId?: string;
    }): Promise<GroupedContractsResponse> {
        const byOrg = organizationId !== undefined ? eq(contractsTable.organizationId, organizationId) : undefined;
        const byOrgC2 = organizationId !== undefined ? sql`AND c2.organization_id = ${organizationId}` : sql``;

        // Get template groups with counts
        // Using raw SQL for the HAVING clause to avoid type issues
        const templateGroups = searchQuery
            ? await this.db
                  .select({
                      templateId: contractTemplatesTable.id,
                      templateKey: contractTemplatesTable.templateKey,
                      templateName: contractTemplatesTable.name,
                      templateDescription: contractTemplatesTable.description,
                      contractCount: count(contractsTable.contractAddress)
                  })
                  .from(contractsTable)
                  .innerJoin(contractTemplatesTable, eq(contractsTable.templateId, contractTemplatesTable.id))
                  .where(and(isNotNull(contractsTable.templateId), byOrg))
                  .groupBy(
                      contractTemplatesTable.id,
                      contractTemplatesTable.templateKey,
                      contractTemplatesTable.name,
                      contractTemplatesTable.description
                  )
                  .having(
                      or(
                          ilike(contractTemplatesTable.name, `%${escapeLike(searchQuery)}%`),
                          // Check if any contract in group matches the search
                          sql`EXISTS (
                              SELECT 1 FROM contracts c2
                              WHERE c2.template_id = ${contractTemplatesTable.id}
                              ${byOrgC2}
                              AND (
                                  ('0x' || encode(c2.contract_address, 'hex')) ILIKE ${`%${escapeLike(searchQuery)}%`}
                                  OR c2.name ILIKE ${`%${escapeLike(searchQuery)}%`}
                              )
                          )`
                      )
                  )
                  .orderBy(desc(count(contractsTable.contractAddress)))
            : await this.db
                  .select({
                      templateId: contractTemplatesTable.id,
                      templateKey: contractTemplatesTable.templateKey,
                      templateName: contractTemplatesTable.name,
                      templateDescription: contractTemplatesTable.description,
                      contractCount: count(contractsTable.contractAddress)
                  })
                  .from(contractsTable)
                  .innerJoin(contractTemplatesTable, eq(contractsTable.templateId, contractTemplatesTable.id))
                  .where(and(isNotNull(contractsTable.templateId), byOrg))
                  .groupBy(
                      contractTemplatesTable.id,
                      contractTemplatesTable.templateKey,
                      contractTemplatesTable.name,
                      contractTemplatesTable.description
                  )
                  .orderBy(desc(count(contractsTable.contractAddress)));

        // For groups that match by contract address/name (not template name), get matching count
        const groupsWithMatchCount: ContractGroupItem[] = [];
        for (const group of templateGroups) {
            let matchingCount: number | undefined;
            if (searchQuery) {
                const templateNameMatches = group.templateName.toLowerCase().includes(searchQuery.toLowerCase());
                if (!templateNameMatches) {
                    // Template name doesn't match, so count matching contracts
                    const pattern = `%${escapeLike(searchQuery)}%`;
                    const [matchResult] = await this.db
                        .select({ count: count() })
                        .from(contractsTable)
                        .where(
                            and(
                                eq(contractsTable.templateId, group.templateId),
                                or(
                                    sql`('0x' || encode(${contractsTable.contractAddress}, 'hex')) ILIKE ${pattern}`,
                                    ilike(contractsTable.name, pattern)
                                ),
                                byOrg
                            )
                        );
                    matchingCount = matchResult?.count ?? 0;
                }
            }
            groupsWithMatchCount.push({
                type: 'group' as const,
                templateId: group.templateId,
                templateKey: group.templateKey,
                templateName: group.templateName,
                templateDescription: group.templateDescription,
                contractCount: Number(group.contractCount),
                ...(matchingCount !== undefined && { matchingContractsCount: matchingCount })
            });
        }

        // Get ungrouped contracts (no template)
        const ungroupedWhere = and(
            isNull(contractsTable.templateId),
            searchQuery ? this.contractSearchClause(searchQuery) : undefined,
            byOrg
        );

        const ungroupedContracts = await this.db.query.contractsTable.findMany({
            where: ungroupedWhere,
            with: {
                disclosedAddresses: {
                    columns: { address: true }
                }
            },
            orderBy: (fields) => fields.createdAt
        });

        // Get total counts
        const totalGroups = groupsWithMatchCount.length;
        const totalUngrouped = ungroupedContracts.length;

        // Calculate total contracts across all groups
        const [totalContractsResult] = await this.db.select({ count: count() }).from(contractsTable).where(byOrg);
        const totalContracts = totalContractsResult?.count ?? 0;

        // Combine groups and ungrouped contracts
        const allItems: GroupedContractItem[] = [
            ...groupsWithMatchCount,
            ...ungroupedContracts.map((c) => ({ ...c, type: 'contract' as const }))
        ];

        // Apply pagination to combined list
        const totalItems = allItems.length;
        const paginatedItems = allItems.slice(offset, offset + limit);

        return {
            items: paginatedItems,
            pagination: this.buildPagination(totalItems, limit, offset),
            totalGroups,
            totalUngrouped,
            totalContracts
        };
    }

    /**
     * Find contracts by template with pagination
     */
    async findByTemplatePaginated({
        templateId,
        limit,
        offset,
        searchQuery,
        organizationId
    }: {
        templateId: number;
        limit: number;
        offset: number;
        searchQuery?: string;
        organizationId?: string;
    }): Promise<ContractsByTemplateResponse> {
        // Get template info
        const template = await this.db.query.contractTemplatesTable.findFirst({
            where: eq(contractTemplatesTable.id, templateId),
            columns: {
                id: true,
                templateKey: true,
                name: true,
                description: true
            }
        });

        if (!template) {
            throw new EntityNotFound('Template', { id: templateId });
        }

        const byOrg = organizationId !== undefined ? eq(contractsTable.organizationId, organizationId) : undefined;
        const whereClause = and(
            eq(contractsTable.templateId, templateId),
            searchQuery ? this.contractSearchClause(searchQuery) : undefined,
            byOrg
        );

        const { items, pagination } = await this.listContractsPage(whereClause, limit, offset);

        return {
            items,
            pagination,
            template: {
                id: template.id,
                templateKey: template.templateKey,
                name: template.name,
                description: template.description
            }
        };
    }

    private async searchByAddress(
        db: DbOrTx,
        contractAddress: Hex,
        opts: { organizationId?: string } = {}
    ): Promise<Contract | undefined> {
        const byOrg =
            opts.organizationId !== undefined ? eq(contractsTable.organizationId, opts.organizationId) : undefined;
        return db.query.contractsTable.findFirst({
            where: and(eq(contractsTable.contractAddress, contractAddress), byOrg),
            with: {
                disclosedAddresses: true
            }
        });
    }

    // With `organizationId`, a contract owned by another org (or the zone) reads as not-found, so
    // cross-org existence never leaks to a caller acting on their own org.
    async findByAddress(contractAddress: Hex, opts: { organizationId?: string } = {}): Promise<Contract> {
        const contract = await this.searchByAddress(this.db, contractAddress, opts);

        if (contract === undefined) {
            throw new EntityNotFound('Contract', { contractAddress });
        }

        return contract;
    }

    /**
     * Resolves templateId from either templateId or templateKey input.
     * If templateKey is provided, looks up the template and returns its id.
     * Throws if templateKey is provided but template not found.
     */
    async resolveTemplateId(
        templateId: number | null | undefined,
        templateKey: string | null | undefined
    ): Promise<number | null> {
        // If templateId is explicitly provided, use it
        if (templateId !== undefined && templateId !== null) {
            return templateId;
        }

        // If templateKey is provided, resolve to templateId
        if (templateKey !== undefined && templateKey !== null) {
            const template = await this.db.query.contractTemplatesTable.findFirst({
                where: eq(contractTemplatesTable.templateKey, templateKey),
                columns: { id: true }
            });
            if (!template) {
                throw new EntityNotFound('Template', { templateKey });
            }
            return template.id;
        }

        return null;
    }

    async create(data: ContractCreate): Promise<Contract> {
        const parsedData = createContractSchema.parse(data);
        this.assertStringIsValidAbi(parsedData.abi);

        const { disclosedAddresses, templateKey, ...fields } = parsedData;
        return this.transaction(async (tx) => {
            // Resolve templateId from templateKey if provided
            const resolvedTemplateId = await tx
                .repositories()
                .contracts.resolveTemplateId(fields.templateId, templateKey);

            // Check if contract already exists
            const existing = await this.searchByAddress(tx, data.contractAddress);
            if (existing) {
                throw new EntityAlreadyExistsError('There is already a contract with this address');
            }

            const [contract] = await tx
                .insert(contractsTable)
                .values({ ...fields, templateId: resolvedTemplateId })
                .returning();

            const createdAddresses = await tx
                .repositories()
                .contracts.createDisclosedAddresses(disclosedAddresses, fields.contractAddress);

            return { ...contract!, disclosedAddresses: createdAddresses };
        });
    }

    private async createDisclosedAddresses(
        addresses: DisclosedAddressList | undefined,
        contractAddress: Address
    ): Promise<Contract['disclosedAddresses']> {
        if (addresses === undefined || addresses.length === 0) return [];

        const rowValues = addresses.map((obj) => ({
            contractAddress,
            address: obj.address
        }));

        return this.db.insert(disclosedAddressesTable).values(rowValues).returning({
            address: disclosedAddressesTable.address
        });
    }

    async update(contractAddress: Hex, data: ContractUpdate): Promise<Contract> {
        // Check if contract exists
        const existing = await this.findByAddress(contractAddress);
        if (!existing) {
            throw new EntityNotFound('Contract', { contractAddress });
        }

        const parsedData = updateContractSchema.parse(data);
        this.assertStringIsValidAbi(parsedData.abi);

        const { disclosedAddresses, templateKey, ...fields } = parsedData;

        return this.transaction(async (tx) => {
            // Resolve templateId from templateKey if provided
            const resolvedTemplateId = await tx
                .repositories()
                .contracts.resolveTemplateId(fields.templateId, templateKey);

            const isChangingAddress = fields.contractAddress.toLowerCase() !== contractAddress.toLowerCase();
            if (isChangingAddress) {
                const existingTarget = await this.searchByAddress(tx, fields.contractAddress);
                if (existingTarget) {
                    throw new EntityAlreadyExistsError('There is already a contract with this address');
                }
            }

            // PUT semantics: disclosed addresses are fully replaced from the request body.
            // Omitting `disclosedAddresses` (undefined) clears them, so callers must echo the
            // existing list to preserve it (the admin panel always does).
            await tx
                .delete(disclosedAddressesTable)
                .where(eq(disclosedAddressesTable.contractAddress, contractAddress));

            const [contract] = await tx
                .update(contractsTable)
                .set({ ...fields, templateId: resolvedTemplateId })
                .where(eq(contractsTable.contractAddress, contractAddress))
                .returning();

            if (contract === undefined) {
                throw new UnexpectedDbError('Error updating contract');
            }

            const createdAddresses = await tx
                .repositories()
                .contracts.createDisclosedAddresses(disclosedAddresses, contract.contractAddress);

            return {
                ...contract,
                disclosedAddresses: createdAddresses
            };
        });
    }

    async delete(contractAddress: Hex): Promise<void> {
        const contractToDelete = await this.searchByAddress(this.db, contractAddress);
        if (!contractToDelete) {
            throw new EntityNotFound('Contract', { contractAddress });
        }

        await this.transaction(async (tx) => {
            const [deleted] = await tx
                .delete(contractsTable)
                .where(eq(contractsTable.contractAddress, contractAddress))
                .returning();

            if (deleted === undefined) {
                throw new EntityNotFound('Contract', { contractAddress });
            }
        });
    }

    /**
     * Returns the bytecode-disclosure config for `address`, or `null` when the
     * contract either does not exist or has bytecode disclosure disabled. The
     * caller uses `disclosureStartBlock` to reject queries below the floor.
     */
    async getBytecodeDisclosureConfig(address: Hex): Promise<BytecodeDisclosureConfig | null> {
        const record = await this.db.query.contractsTable.findFirst({
            where: (f, { eq }) => eq(f.contractAddress, address),
            columns: { discloseBytecode: true, disclosureStartBlock: true }
        });

        if (!record?.discloseBytecode) return null;
        return { disclosureStartBlock: record.disclosureStartBlock };
    }

    private assertStringIsValidAbi(abiStr: string) {
        try {
            Abi.parse(JSON.parse(abiStr));
        } catch {
            throw new InvalidInputError('Invalid ABI format - must be valid JSON encoded abi');
        }
    }

    /** Owning organization per address, for org-scoping decisions. Addresses with no contract row are absent. */
    async organizationIdsByAddresses(addresses: Hex[]): Promise<Map<string, string | null>> {
        if (addresses.length === 0) {
            return new Map();
        }

        const rows = await fetchChunked(addresses, (chunk) =>
            this.db
                .select({ address: contractsTable.contractAddress, organizationId: contractsTable.organizationId })
                .from(contractsTable)
                .where(inArray(contractsTable.contractAddress, chunk))
        );
        return new Map(rows.map((r) => [r.address.toLowerCase(), r.organizationId]));
    }

    async allContractAddressesForOrg(orgId: string): Promise<Address[]> {
        const rows = await this.db
            .select({ address: contractsTable.contractAddress })
            .from(contractsTable)
            .innerJoin(organizationsTable, eq(organizationsTable.id, contractsTable.organizationId))
            .where(and(eq(contractsTable.organizationId, orgId), isNull(organizationsTable.deletedAt)));
        return rows.map((r) => r.address);
    }

    private async listContractsPage(
        whereClause: SQL | undefined,
        limit: number,
        offset: number
    ): Promise<PaginatedResult<Contract>> {
        const items = await this.db.query.contractsTable.findMany({
            where: whereClause,
            with: { disclosedAddresses: { columns: { address: true } } },
            orderBy: (fields) => fields.createdAt,
            limit,
            offset
        });

        const [countResult] = await this.db.select({ count: count() }).from(contractsTable).where(whereClause);
        return { items, pagination: this.buildPagination(countResult?.count ?? 0, limit, offset) };
    }

    private buildPagination(totalItems: number, limit: number, offset: number) {
        return {
            currentPage: Math.floor(offset / limit) + 1,
            totalPages: Math.ceil(totalItems / limit),
            totalItems,
            limit,
            offset
        };
    }

    private contractSearchClause(searchQuery: string) {
        const pattern = `%${escapeLike(searchQuery)}%`;
        return sql`(
            ${contractsTable.name} ILIKE ${pattern}
            OR ('0x' || encode(${contractsTable.contractAddress}, 'hex')) ILIKE ${pattern}
            OR ${contractsTable.description} ILIKE ${pattern}
        )`;
    }
}
