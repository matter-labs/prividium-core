import { type Address, type Hex, pad, parseAbiItem, toEventSelector } from 'viem';
import { beforeEach, describe, expect } from 'vitest';
import { type Fixture, it } from '../../test/unit-test-context';
import { Repositories } from '../db';
import { type TopicConditionType, topicConditionEnum } from '../db/schema';
import { ContractEventsPermissionsRepository } from '../repositories/contract-events-permissions-repository';
import { type Contract, ContractsRepository } from '../repositories/contracts-repository';
import { OrganizationsRepository } from '../repositories/organizations-repository';
import { type Role, RolesRepository } from '../repositories/roles-repository';
import { type User, UsersRepository } from '../repositories/users-repository';
import { EntityNotFound } from '../utils/error-types';
import { type EventDefinition, EventPermissionVerifier } from './event-permission-verifier';

describe('EventPermissionVerifier', () => {
    let eventPermissionRepo: ContractEventsPermissionsRepository;
    let rolesRepo: RolesRepository;
    let userRepo: UsersRepository;
    let contractsRepository: ContractsRepository;
    let orgsRepo: OrganizationsRepository;
    let permissionVerifier: EventPermissionVerifier;
    let verifierWithoutMultiOrg: EventPermissionVerifier;
    let aContract: Contract;
    let aRole: Role;

    const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
    const transferEventSelector = toEventSelector(transferEvent);

    const validAbi = JSON.stringify([transferEvent]);

    const testContractAddress = pad('0x01', { size: 20 });

    beforeEach<Fixture>(async ({ db }) => {
        contractsRepository = new ContractsRepository(db);
        orgsRepo = new OrganizationsRepository(db);
        eventPermissionRepo = new ContractEventsPermissionsRepository(db);
        rolesRepo = new RolesRepository(db);
        userRepo = new UsersRepository(db);
        permissionVerifier = new EventPermissionVerifier(new Repositories(db), true);
        verifierWithoutMultiOrg = new EventPermissionVerifier(new Repositories(db), false);

        aContract = await contractsRepository.create({
            contractAddress: testContractAddress,
            abi: validAbi,
            name: 'Test Contract',
            description: 'A test contract',
            discloseErc20TotalSupply: false,
            discloseBytecode: true,
            disclosureStartBlock: '0x0',
            disclosedAddresses: []
        });
        aRole = await rolesRepo.create({
            roleName: 'existingRole',
            systemPermissions: []
        });
    });

    async function createUser(roles: Role[], addresses: Address[] = []) {
        return userRepo.create({
            displayName: 'Test User',
            roles: roles.map((r) => r.id),
            wallets: addresses,
            source: 'adminPanel'
        });
    }

    async function check(user: User, event: Omit<EventDefinition, 'contractAddress'>): Promise<boolean> {
        return (
            await permissionVerifier.checkMany(
                {
                    roleIds: user.roles.map((r) => r.id),
                    wallets: user.wallets.map((w) => w.walletAddress),
                    organizationId: user.organizationId
                },
                [{ ...event, contractAddress: aContract.contractAddress }]
            )
        )[0]!;
    }

    describe('getRules', () => {
        it('deduplicates rules when permission is assigned to multiple roles', async () => {
            const roleB = await rolesRepo.create({
                roleName: 'anotherRole',
                systemPermissions: []
            });

            await eventPermissionRepo.create({
                contractAddress: aContract.contractAddress,
                roles: [aRole, roleB],
                topic0Constant: transferEventSelector,
                topic1Constant: null,
                topic2Constant: null,
                topic3Constant: null
            });

            const user = await createUser([aRole, roleB]);

            const rules = await permissionVerifier.getRules(user.id);

            expect(rules).toHaveLength(1);
            expect(rules[0]?.contractAddress).toBe(aContract.contractAddress);
            expect(rules[0]?.topic0).toBe(transferEventSelector);
        });

        it('throws EntityNotFound for non-existent user', async () => {
            await expect(permissionVerifier.getRules('non-existent-id')).rejects.toThrow(EntityNotFound);
        });

        it('returns empty array when user has no roles', async () => {
            const user = await createUser([]);
            const rules = await permissionVerifier.getRules(user.id);
            expect(rules).toEqual([]);
        });

        it('converts all condition types to rules correctly', async () => {
            const topic0 = transferEventSelector;
            const topic1Constant = pad('0x01');

            await eventPermissionRepo.create({
                contractAddress: aContract.contractAddress,
                roles: [aRole],
                topic0Constant: topic0,
                topic1Constant: topic1Constant,
                topic1ConditionType: topicConditionEnum.enum.equalTo,
                topic2Constant: null,
                topic2ConditionType: topicConditionEnum.enum.userAddress,
                topic3Constant: null,
                topic3ConditionType: null
            });

            const user = await createUser([aRole]);
            const rules = await permissionVerifier.getRules(user.id);

            expect(rules).toHaveLength(1);
            expect(rules[0]).toEqual({
                contractAddress: aContract.contractAddress,
                topic0: topic0,
                topic1: { type: 'equalTo', value: topic1Constant },
                topic2: { type: 'userAddress' },
                topic3: null
            });
        });
    });

    describe('permissions with selector (topic0)', () => {
        beforeEach(async () => {
            await eventPermissionRepo.create({
                contractAddress: aContract.contractAddress,
                roles: [aRole],
                topic0Constant: transferEventSelector,
                topic1Constant: null,
                topic2Constant: null,
                topic3Constant: null
            });
        });

        it('a user with permission can see matching events', async () => {
            const user = await createUser([aRole]);

            const def = {
                contractAddress: aContract.contractAddress,
                topic0: transferEventSelector
            };

            expect(await check(user, def)).toEqual(true);
        });

        it('rejects event with non-matching topic0', async () => {
            const user = await createUser([aRole]);
            const otherSelector = pad('0xdead');

            expect(await check(user, { topic0: otherSelector })).toEqual(false);
        });

        it('rejects event when user has a role without matching permission', async () => {
            const otherRole = await rolesRepo.create({ roleName: 'otherRole', systemPermissions: [] });
            const user = await createUser([otherRole]);

            const def = {
                contractAddress: aContract.contractAddress,
                topic0: transferEventSelector
            };

            expect(await check(user, def)).toEqual(false);
        });

        it('a user with no permission can not see matching events', async () => {
            const user = await createUser([]);

            const def = {
                contractAddress: aContract.contractAddress,
                topic0: transferEventSelector
            };

            expect(await check(user, def)).toEqual(false);
        });
    });

    describe('equalTo rules', () => {
        async function createEventRule(constants: (Hex | null)[]) {
            await eventPermissionRepo.create({
                contractAddress: aContract.contractAddress,
                roles: [aRole],
                topic0Constant: null,
                topic1Constant: constants[0] ?? null,
                topic1ConditionType: constants[0] ? topicConditionEnum.enum.equalTo : null,
                topic2Constant: constants[1] ?? null,
                topic2ConditionType: constants[1] ? topicConditionEnum.enum.equalTo : null,
                topic3Constant: constants[2] ?? null,
                topic3ConditionType: constants[2] ? topicConditionEnum.enum.equalTo : null
            });
        }

        it('permission over topic1 constant allows to see logs with that constant', async () => {
            await createEventRule([pad('0x01'), null, null]);
            const user = await createUser([aRole]);

            expect(await check(user, { topic1: pad('0x01') })).toBe(true);
        });

        it('permission over topic1 constant do not allow to see logs with other values', async () => {
            await createEventRule([pad('0x01'), null, null]);
            const user = await createUser([aRole]);

            expect(await check(user, { topic1: pad('0x02') })).toBe(false);
        });

        it('equalTo over topic2 allows to see matching value', async () => {
            await createEventRule([null, pad('0x01'), null]);
            const user = await createUser([aRole]);

            expect(await check(user, { topic2: pad('0x01') })).toBe(true);
        });

        it('equalTo over topic2 do not allows to see non matching value', async () => {
            await createEventRule([null, pad('0x01'), null]);
            const user = await createUser([aRole]);

            expect(await check(user, { topic2: pad('0x02') })).toBe(false);
        });

        it('equalTo over topic3 allows to see matching value', async () => {
            await createEventRule([null, null, pad('0x01')]);
            const user = await createUser([aRole]);

            expect(await check(user, { topic3: pad('0x01') })).toBe(true);
        });

        it('equalTo over topic3 do not allows to see non matching value', async () => {
            await createEventRule([null, null, pad('0x01')]);
            const user = await createUser([aRole]);

            expect(await check(user, { topic3: pad('0x02') })).toBe(false);
        });

        it('user withot the permission cannot bypass the rule', async () => {
            await createEventRule([pad('0x01'), null, null]);
            await createEventRule([null, pad('0x01'), null]);
            await createEventRule([null, null, pad('0x01')]);
            const user = await createUser([]);

            expect(await check(user, { topic1: pad('0x01') })).toBe(false);
            expect(await check(user, { topic2: pad('0x01') })).toBe(false);
            expect(await check(user, { topic3: pad('0x01') })).toBe(false);
        });

        it('rules for 2 topics only pass if both topics match at the same time', async () => {
            await createEventRule([pad('0x01'), pad('0x02'), null]);
            const user = await createUser([aRole]);

            expect(await check(user, { topic1: pad('0x01'), topic2: pad('0x02') })).toBe(true);
            expect(await check(user, { topic1: pad('0x02'), topic2: pad('0x01') })).toBe(false);
            expect(await check(user, { topic1: pad('0x01'), topic2: undefined })).toBe(false);
            expect(await check(user, { topic1: undefined, topic2: pad('0x02') })).toBe(false);
        });

        it('rules for 3 topics only pass if both topics match at the same time', async () => {
            await createEventRule([pad('0x01'), pad('0x02'), pad('0x03')]);
            const user = await createUser([aRole]);

            expect(await check(user, { topic1: pad('0x01'), topic2: pad('0x02'), topic3: pad('0x03') })).toBe(true);
            expect(await check(user, { topic1: pad('0x02'), topic2: pad('0x01') })).toBe(false);
            expect(await check(user, { topic1: pad('0x02'), topic2: pad('0x03'), topic3: pad('0x01') })).toBe(false);
        });
    });

    describe('userAddress rules', () => {
        const userAddresses: [Address, Address] = [pad('0xaa', { size: 20 }), pad('0xbb', { size: 20 })];
        const nonUserAddress = pad('0xffff', { size: 20 });

        async function createEventRule(topicsToCheck: [boolean, boolean, boolean]) {
            await eventPermissionRepo.create({
                contractAddress: aContract.contractAddress,
                roles: [aRole],
                topic0Constant: null,
                topic1Constant: null,
                topic2Constant: null,
                topic3Constant: null,
                topic1ConditionType: topicsToCheck[0] ? topicConditionEnum.enum.userAddress : null,
                topic2ConditionType: topicsToCheck[1] ? topicConditionEnum.enum.userAddress : null,
                topic3ConditionType: topicsToCheck[2] ? topicConditionEnum.enum.userAddress : null
            });
        }

        it('applies address filter for topic 1', async () => {
            await createEventRule([true, false, false]);
            const user = await createUser([aRole], userAddresses);

            expect(await check(user, { topic1: pad(userAddresses[0]) })).toBe(true);
            expect(await check(user, { topic1: pad(userAddresses[1]) })).toBe(true);
            expect(await check(user, { topic2: pad(userAddresses[0]) })).toBe(false);
            expect(await check(user, { topic1: pad(nonUserAddress) })).toBe(false);
        });

        it('applies address filter for topic 2', async () => {
            await createEventRule([false, true, false]);
            const user = await createUser([aRole], userAddresses);

            expect(await check(user, { topic2: pad(userAddresses[0]) })).toBe(true);
            expect(await check(user, { topic2: pad(userAddresses[1]) })).toBe(true);
            expect(await check(user, { topic1: pad(userAddresses[0]) })).toBe(false);
            expect(await check(user, { topic2: pad(nonUserAddress) })).toBe(false);
        });

        it('applies address filter for topic 3', async () => {
            await createEventRule([false, false, true]);
            const user = await createUser([aRole], userAddresses);

            expect(await check(user, { topic3: pad(userAddresses[0]) })).toBe(true);
            expect(await check(user, { topic3: pad(userAddresses[1]) })).toBe(true);
            expect(await check(user, { topic1: pad(userAddresses[0]) })).toBe(false);
            expect(await check(user, { topic3: pad(nonUserAddress) })).toBe(false);
        });

        it('does not allow to see events to users with no permission', async () => {
            await createEventRule([true, false, false]);
            const user = await createUser([], userAddresses);

            expect(await check(user, { topic1: pad(userAddresses[0]) })).toBe(false);
            expect(await check(user, { topic1: pad(userAddresses[1]) })).toBe(false);
        });

        it('when multiple topics set all have to match at the seme time', async () => {
            await createEventRule([true, true, false]);
            const user = await createUser([aRole], userAddresses);

            expect(await check(user, { topic1: pad(userAddresses[0]), topic2: pad(userAddresses[1]) })).toBe(true);
            expect(await check(user, { topic1: pad(userAddresses[1]), topic2: pad(userAddresses[0]) })).toBe(true);
            expect(await check(user, { topic1: pad(userAddresses[0]), topic2: pad(userAddresses[0]) })).toBe(true);
            expect(await check(user, { topic1: pad(userAddresses[0]), topic2: pad(nonUserAddress) })).toBe(false);
            expect(await check(user, { topic1: pad(nonUserAddress), topic2: pad(userAddresses[0]) })).toBe(false);
        });
    });

    describe('mixed permission types', () => {
        const userAddresses: [Address, Address] = [pad('0xaa', { size: 20 }), pad('0xbb', { size: 20 })];
        const nonUserAddress = pad('0xffff', { size: 20 });

        type Def = { constant: null | Hex; type: TopicConditionType | null };
        async function createEventRule(topicsToCheck: Def[]) {
            await eventPermissionRepo.create({
                contractAddress: aContract.contractAddress,
                roles: [aRole],
                topic0Constant: topicsToCheck[0]?.constant ?? null,
                topic1Constant: topicsToCheck[1]?.constant ?? null,
                topic1ConditionType: topicsToCheck[1]?.type ?? null,
                topic2Constant: topicsToCheck[2]?.constant ?? null,
                topic2ConditionType: topicsToCheck[2]?.type ?? null,
                topic3Constant: topicsToCheck[3]?.constant ?? null,
                topic3ConditionType: topicsToCheck[3]?.type ?? null
            });
        }

        it('checks constant and address mixed', async () => {
            const constant = pad('0x0101');
            await createEventRule([
                { type: null, constant: null }, // topic0
                { type: topicConditionEnum.enum.userAddress, constant: null }, // topic1
                { type: topicConditionEnum.enum.equalTo, constant: constant } // topic2
            ]);
            const user = await createUser([aRole], userAddresses);

            expect(await check(user, { topic1: pad(userAddresses[0]), topic2: constant })).toBe(true);
            expect(await check(user, { topic1: pad(userAddresses[1]), topic2: constant })).toBe(true);
            expect(await check(user, { topic1: pad(nonUserAddress), topic2: constant })).toBe(false);
            expect(await check(user, { topic1: pad(constant), topic2: pad(userAddresses[1]) })).toBe(false);
        });

        it('different conditions on different permissions make any of them work', async () => {
            const constant = pad('0x0101');
            await createEventRule([
                { type: null, constant: null }, // topic0
                { type: topicConditionEnum.enum.equalTo, constant: constant } // topic1
            ]);
            await createEventRule([
                { type: null, constant: null }, // topic0
                { type: null, constant: null }, // topic1
                { type: topicConditionEnum.enum.userAddress, constant: null } // topic2
            ]);
            const user = await createUser([aRole], userAddresses);

            expect(await check(user, { topic1: constant, topic2: pad(userAddresses[0]) })).toBe(true);
            expect(await check(user, { topic1: undefined, topic2: pad(userAddresses[0]) })).toBe(true);
            expect(await check(user, { topic1: constant, topic2: undefined })).toBe(true);
            expect(await check(user, { topic1: pad(userAddresses[0]), topic2: constant })).toBe(false);
            expect(await check(user, { topic1: undefined, topic2: undefined })).toBe(false);
        });
    });

    describe('batch and multi-contract behavior', () => {
        it('returns correct per-event booleans for multiple events', async () => {
            await eventPermissionRepo.create({
                contractAddress: aContract.contractAddress,
                roles: [aRole],
                topic0Constant: transferEventSelector,
                topic1Constant: null,
                topic2Constant: null,
                topic3Constant: null
            });

            const otherSelector = pad('0xdead');

            const result = await permissionVerifier.checkMany(
                { roleIds: [aRole.id], wallets: [], organizationId: null },
                [
                    { contractAddress: aContract.contractAddress, topic0: transferEventSelector },
                    { contractAddress: aContract.contractAddress, topic0: otherSelector },
                    { contractAddress: aContract.contractAddress, topic0: transferEventSelector }
                ]
            );
            expect(result).toEqual([true, false, true]);
        });

        it('handles events across multiple contracts', async () => {
            const secondContract = await contractsRepository.create({
                contractAddress: pad('0x02', { size: 20 }),
                abi: validAbi,
                name: 'Second Contract',
                description: 'Another contract',
                discloseErc20TotalSupply: false,
                discloseBytecode: true,
                disclosureStartBlock: '0x0',
                disclosedAddresses: []
            });

            await eventPermissionRepo.create({
                contractAddress: aContract.contractAddress,
                roles: [aRole],
                topic0Constant: transferEventSelector,
                topic1Constant: null,
                topic2Constant: null,
                topic3Constant: null
            });

            const result = await permissionVerifier.checkMany(
                { roleIds: [aRole.id], wallets: [], organizationId: null },
                [
                    { contractAddress: aContract.contractAddress, topic0: transferEventSelector },
                    { contractAddress: secondContract.contractAddress, topic0: transferEventSelector }
                ]
            );
            expect(result).toEqual([true, false]);
        });

        it('returns empty array for empty events', async () => {
            const result = await permissionVerifier.checkMany(
                { roleIds: [aRole.id], wallets: [], organizationId: null },
                []
            );
            expect(result).toEqual([]);
        });
    });

    describe('couldQueryMatch', () => {
        it('returns false for non-existent user', async () => {
            const result = await permissionVerifier.couldQueryMatch('non-existent-id', {
                address: aContract.contractAddress
            });
            expect(result).toBe(false);
        });

        it('returns false for user with no roles', async () => {
            await eventPermissionRepo.create({
                contractAddress: aContract.contractAddress,
                roles: [aRole],
                topic0Constant: transferEventSelector,
                topic1Constant: null,
                topic2Constant: null,
                topic3Constant: null
            });

            const user = await createUser([]);
            const result = await permissionVerifier.couldQueryMatch(user.id, {
                address: aContract.contractAddress,
                topics: [transferEventSelector]
            });
            expect(result).toBe(false);
        });

        it('returns true when user has matching permission', async () => {
            await eventPermissionRepo.create({
                contractAddress: aContract.contractAddress,
                roles: [aRole],
                topic0Constant: transferEventSelector,
                topic1Constant: null,
                topic2Constant: null,
                topic3Constant: null
            });

            const user = await createUser([aRole]);
            const result = await permissionVerifier.couldQueryMatch(user.id, {
                address: aContract.contractAddress,
                topics: [transferEventSelector]
            });
            expect(result).toBe(true);
        });
    });

    describe('organizationOnly scoping', () => {
        const orgContractAddress = pad('0x0abc', { size: 20 });

        async function orgOwnedContractWithPermission(organizationOnly: boolean) {
            const org = await orgsRepo.create({ name: `Events Org ${organizationOnly}`, defaultRoles: [] });
            await contractsRepository.create({
                contractAddress: orgContractAddress,
                abi: validAbi,
                name: 'Org Contract',
                description: null,
                discloseErc20TotalSupply: false,
                discloseBytecode: true,
                disclosureStartBlock: '0x0',
                disclosedAddresses: [],
                organizationId: org.id
            });
            await eventPermissionRepo.create({
                contractAddress: orgContractAddress,
                roles: [aRole],
                topic0Constant: transferEventSelector,
                topic1Constant: null,
                topic2Constant: null,
                topic3Constant: null,
                topic1ConditionType: null,
                topic2ConditionType: null,
                topic3ConditionType: null,
                organizationOnly
            });
            return org;
        }

        const transferEventOnOrgContract: EventDefinition = {
            contractAddress: orgContractAddress,
            topic0: transferEventSelector
        };

        it('grants an org-only permission to a member of the contract organization', async () => {
            const org = await orgOwnedContractWithPermission(true);
            const result = await permissionVerifier.checkMany(
                { roleIds: [aRole.id], wallets: [], organizationId: org.id },
                [transferEventOnOrgContract]
            );
            expect(result).toEqual([true]);
        });

        it('denies an org-only permission to zone users and members of other organizations', async () => {
            await orgOwnedContractWithPermission(true);
            for (const organizationId of [null, 'another-org']) {
                const result = await permissionVerifier.checkMany(
                    { roleIds: [aRole.id], wallets: [], organizationId },
                    [transferEventOnOrgContract]
                );
                expect(result).toEqual([false]);
            }
        });

        it('leaves a permission opened zone-wide (organizationOnly=false) unscoped', async () => {
            await orgOwnedContractWithPermission(false);
            const result = await permissionVerifier.checkMany(
                { roleIds: [aRole.id], wallets: [], organizationId: null },
                [transferEventOnOrgContract]
            );
            expect(result).toEqual([true]);
        });

        it('admits an m2m reader only when the contract organization is linked, with its wallets narrowed', async () => {
            const org = await orgOwnedContractWithPermission(true);
            const linkedEvent: EventDefinition = {
                ...transferEventOnOrgContract,
                topic2: pad('0xaa', { size: 32 })
            };

            const linked = await permissionVerifier.checkMany(
                {
                    roleIds: [aRole.id],
                    wallets: [pad('0xaa', { size: 20 }), pad('0xbb', { size: 20 })],
                    organizationId: null,
                    linkedOrgWallets: new Map([[org.id, [pad('0xaa', { size: 20 })]]])
                },
                [linkedEvent]
            );
            expect(linked).toEqual([true]);

            const unlinked = await permissionVerifier.checkMany(
                {
                    roleIds: [aRole.id],
                    wallets: [pad('0xaa', { size: 20 })],
                    organizationId: null,
                    linkedOrgWallets: new Map([['some-other-org', [pad('0xaa', { size: 20 })]]])
                },
                [linkedEvent]
            );
            expect(unlinked).toEqual([false]);
        });

        it('excludes foreign-org org-only permissions from a user rules export', async () => {
            await orgOwnedContractWithPermission(true);
            const user = await createUser([aRole]);
            const rules = await permissionVerifier.getRules(user.id);
            expect(rules).toEqual([]);
        });

        // MULTI_ORG_ENABLED is off by default, and the flag has to switch the gate off entirely:
        // organizationOnly rows predate multi-org and must not start denying reads.
        it('ignores org-only scoping when multi-org is disabled', async () => {
            await orgOwnedContractWithPermission(true);

            const result = await verifierWithoutMultiOrg.checkMany(
                { roleIds: [aRole.id], wallets: [], organizationId: null },
                [transferEventOnOrgContract]
            );
            expect(result).toEqual([true]);

            const user = await createUser([aRole]);
            expect(await verifierWithoutMultiOrg.getRules(user.id)).not.toEqual([]);
        });

        it('denies an m2m reader with no linked organizations', async () => {
            await orgOwnedContractWithPermission(true);

            const result = await permissionVerifier.checkMany(
                {
                    roleIds: [aRole.id],
                    wallets: [],
                    organizationId: null,
                    linkedOrgWallets: new Map()
                },
                [transferEventOnOrgContract]
            );
            expect(result).toEqual([false]);
        });

        // A linked org with no member wallets yields an empty wallet list, which still admits the
        // permission - only a null context denies it.
        it('admits an m2m reader linked to an organization that has no member wallets', async () => {
            const org = await orgOwnedContractWithPermission(true);

            const result = await permissionVerifier.checkMany(
                {
                    roleIds: [aRole.id],
                    wallets: [],
                    organizationId: null,
                    linkedOrgWallets: new Map([[org.id, []]])
                },
                [transferEventOnOrgContract]
            );
            expect(result).toEqual([true]);
        });
    });

    describe('organization visibility', () => {
        // A contract address the org owns but for which the user has NO matching event permission.
        const orgContract = testContractAddress;
        const nonOrgContract = pad('0x02', { size: 20 });

        describe('checkMany', () => {
            it('returns true for a log from an org contract even without a matching permission', async () => {
                const user = await createUser([aRole]);

                const result = await permissionVerifier.checkMany(
                    {
                        roleIds: user.roles.map((r) => r.id),
                        wallets: user.wallets.map((w) => w.walletAddress),
                        organizationId: user.organizationId
                    },
                    [{ contractAddress: orgContract, topic0: transferEventSelector }],
                    [orgContract]
                );

                expect(result).toEqual([true]);
            });

            it('does not grant visibility to logs from contracts outside the org list', async () => {
                const result = await permissionVerifier.checkMany(
                    { roleIds: [aRole.id], wallets: [], organizationId: null },
                    [{ contractAddress: nonOrgContract, topic0: transferEventSelector }],
                    [orgContract]
                );

                expect(result).toEqual([false]);
            });

            it('mixes org visibility and permission checks per event', async () => {
                await eventPermissionRepo.create({
                    contractAddress: aContract.contractAddress,
                    roles: [aRole],
                    topic0Constant: transferEventSelector,
                    topic1Constant: null,
                    topic2Constant: null,
                    topic3Constant: null
                });
                const user = await createUser([aRole]);

                const result = await permissionVerifier.checkMany(
                    {
                        roleIds: user.roles.map((r) => r.id),
                        wallets: user.wallets.map((w) => w.walletAddress),
                        organizationId: user.organizationId
                    },
                    [
                        // visible by org membership (no permission needed)
                        { contractAddress: orgContract, topic0: pad('0xdead') },
                        // visible by event permission (topic0 matches)
                        { contractAddress: aContract.contractAddress, topic0: transferEventSelector },
                        // neither org nor permission match
                        { contractAddress: nonOrgContract, topic0: pad('0xdead') }
                    ],
                    [orgContract]
                );

                expect(result).toEqual([true, true, false]);
            });
        });

        describe('couldQueryMatch', () => {
            it('returns true when the address filter targets an org contract without a matching permission', async () => {
                const user = await createUser([aRole]);

                const result = await permissionVerifier.couldQueryMatch(user.id, { address: orgContract }, [
                    orgContract
                ]);

                expect(result).toBe(true);
            });

            it('returns true for an unfiltered query when the user has org contracts', async () => {
                const user = await createUser([aRole]);

                const result = await permissionVerifier.couldQueryMatch(user.id, {}, [orgContract]);

                expect(result).toBe(true);
            });

            it('falls back to permission checks when the filter targets a non-org address', async () => {
                const user = await createUser([aRole]);

                const result = await permissionVerifier.couldQueryMatch(user.id, { address: nonOrgContract }, [
                    orgContract
                ]);

                expect(result).toBe(false);
            });
        });
    });

    describe('couldQueryMatchForTenant', () => {
        it('returns false when roleNames is empty', async () => {
            const result = await permissionVerifier.couldQueryMatchForTenant([], [], {
                address: aContract.contractAddress
            });
            expect(result).toBe(false);
        });

        it('returns true with matching permission and address filter', async () => {
            await eventPermissionRepo.create({
                contractAddress: aContract.contractAddress,
                roles: [aRole],
                topic0Constant: transferEventSelector,
                topic1Constant: null,
                topic2Constant: null,
                topic3Constant: null
            });

            const result = await permissionVerifier.couldQueryMatchForTenant([], [aRole.id], {
                address: aContract.contractAddress,
                topics: [transferEventSelector]
            });
            expect(result).toBe(true);
        });

        it('returns true without address filter', async () => {
            await eventPermissionRepo.create({
                contractAddress: aContract.contractAddress,
                roles: [aRole],
                topic0Constant: transferEventSelector,
                topic1Constant: null,
                topic2Constant: null,
                topic3Constant: null
            });

            const result = await permissionVerifier.couldQueryMatchForTenant([], [aRole.id], {
                topics: [transferEventSelector]
            });
            expect(result).toBe(true);
        });

        it('returns false when no permissions match', async () => {
            const result = await permissionVerifier.couldQueryMatchForTenant([], [aRole.id], {
                address: aContract.contractAddress,
                topics: [transferEventSelector]
            });
            expect(result).toBe(false);
        });
    });

    describe('couldPermissionMatchQuery - timing oracle protection', () => {
        const userAddresses: [Address, Address] = [pad('0xaa', { size: 20 }), pad('0xbb', { size: 20 })];

        describe('address matching', () => {
            it('query with matching address is compatible', () => {
                const permission = {
                    id: '1',
                    contractAddress: testContractAddress,
                    topic0Constant: null,
                    topic1Constant: null,
                    topic1ConditionType: null,
                    topic2Constant: null,
                    topic2ConditionType: null,
                    topic3Constant: null,
                    topic3ConditionType: null,
                    organizationOnly: true,
                    createdAt: new Date(),
                    updatedAt: new Date()
                };

                const result = permissionVerifier.couldPermissionMatchQuery([], permission, {
                    address: testContractAddress
                });

                expect(result).toBe(true);
            });

            it('query with non-matching address is not compatible', () => {
                const otherContract = pad('0x02', { size: 20 });
                const permission = {
                    id: '1',
                    contractAddress: testContractAddress,
                    topic0Constant: null,
                    topic1Constant: null,
                    topic1ConditionType: null,
                    topic2Constant: null,
                    topic2ConditionType: null,
                    topic3Constant: null,
                    topic3ConditionType: null,
                    organizationOnly: true,
                    createdAt: new Date(),
                    updatedAt: new Date()
                };

                const result = permissionVerifier.couldPermissionMatchQuery([], permission, {
                    address: otherContract
                });

                expect(result).toBe(false);
            });

            it('query with address array containing matching address is compatible', () => {
                const otherContract = pad('0x02', { size: 20 });
                const permission = {
                    id: '1',
                    contractAddress: testContractAddress,
                    topic0Constant: null,
                    topic1Constant: null,
                    topic1ConditionType: null,
                    topic2Constant: null,
                    topic2ConditionType: null,
                    topic3Constant: null,
                    topic3ConditionType: null,
                    organizationOnly: true,
                    createdAt: new Date(),
                    updatedAt: new Date()
                };

                const result = permissionVerifier.couldPermissionMatchQuery([], permission, {
                    address: [otherContract, testContractAddress]
                });

                expect(result).toBe(true);
            });

            it('query without address (wildcard) matches any permission', () => {
                const permission = {
                    id: '1',
                    contractAddress: testContractAddress,
                    topic0Constant: null,
                    topic1Constant: null,
                    topic1ConditionType: null,
                    topic2Constant: null,
                    topic2ConditionType: null,
                    topic3Constant: null,
                    topic3ConditionType: null,
                    organizationOnly: true,
                    createdAt: new Date(),
                    updatedAt: new Date()
                };

                const result = permissionVerifier.couldPermissionMatchQuery([], permission, {});

                expect(result).toBe(true);
            });
        });

        describe('topic matching - equalTo condition', () => {
            it('query with matching topic value is compatible', () => {
                const permission = {
                    id: '1',
                    contractAddress: testContractAddress,
                    topic0Constant: transferEventSelector,
                    topic1Constant: null,
                    topic1ConditionType: null,
                    topic2Constant: null,
                    topic2ConditionType: null,
                    topic3Constant: null,
                    topic3ConditionType: null,
                    organizationOnly: true,
                    createdAt: new Date(),
                    updatedAt: new Date()
                };

                const result = permissionVerifier.couldPermissionMatchQuery([], permission, {
                    address: testContractAddress,
                    topics: [transferEventSelector]
                });

                expect(result).toBe(true);
            });

            it('query with non-matching topic value is not compatible', () => {
                const otherSelector = pad('0xdead');
                const permission = {
                    id: '1',
                    contractAddress: testContractAddress,
                    topic0Constant: transferEventSelector,
                    topic1Constant: null,
                    topic1ConditionType: null,
                    topic2Constant: null,
                    topic2ConditionType: null,
                    topic3Constant: null,
                    topic3ConditionType: null,
                    organizationOnly: true,
                    createdAt: new Date(),
                    updatedAt: new Date()
                };

                const result = permissionVerifier.couldPermissionMatchQuery([], permission, {
                    address: testContractAddress,
                    topics: [otherSelector]
                });

                expect(result).toBe(false);
            });

            it('query with topic array containing matching value is compatible', () => {
                const otherSelector = pad('0xdead');
                const permission = {
                    id: '1',
                    contractAddress: testContractAddress,
                    topic0Constant: transferEventSelector,
                    topic1Constant: null,
                    topic1ConditionType: null,
                    topic2Constant: null,
                    topic2ConditionType: null,
                    topic3Constant: null,
                    topic3ConditionType: null,
                    organizationOnly: true,
                    createdAt: new Date(),
                    updatedAt: new Date()
                };

                const result = permissionVerifier.couldPermissionMatchQuery([], permission, {
                    address: testContractAddress,
                    topics: [[otherSelector, transferEventSelector]]
                });

                expect(result).toBe(true);
            });

            it('query with null topic (wildcard) matches equalTo permission', () => {
                const permission = {
                    id: '1',
                    contractAddress: testContractAddress,
                    topic0Constant: transferEventSelector,
                    topic1Constant: null,
                    topic1ConditionType: null,
                    topic2Constant: null,
                    topic2ConditionType: null,
                    topic3Constant: null,
                    topic3ConditionType: null,
                    organizationOnly: true,
                    createdAt: new Date(),
                    updatedAt: new Date()
                };

                const result = permissionVerifier.couldPermissionMatchQuery([], permission, {
                    address: testContractAddress,
                    topics: [null]
                });

                expect(result).toBe(true);
            });
        });

        describe('topic matching - userAddress condition', () => {
            it('query with user wallet address is compatible', () => {
                const permission = {
                    id: '1',
                    contractAddress: testContractAddress,
                    topic0Constant: null,
                    topic1Constant: null,
                    topic1ConditionType: topicConditionEnum.enum.userAddress,
                    topic2Constant: null,
                    topic2ConditionType: null,
                    topic3Constant: null,
                    topic3ConditionType: null,
                    organizationOnly: true,
                    createdAt: new Date(),
                    updatedAt: new Date()
                };

                const result = permissionVerifier.couldPermissionMatchQuery(userAddresses, permission, {
                    address: testContractAddress,
                    topics: [null, pad(userAddresses[0])]
                });

                expect(result).toBe(true);
            });

            it('query with non-user address is not compatible', () => {
                const otherAddress = pad('0xffff', { size: 20 });
                const permission = {
                    id: '1',
                    contractAddress: testContractAddress,
                    topic0Constant: null,
                    topic1Constant: null,
                    topic1ConditionType: topicConditionEnum.enum.userAddress,
                    topic2Constant: null,
                    topic2ConditionType: null,
                    topic3Constant: null,
                    topic3ConditionType: null,
                    organizationOnly: true,
                    createdAt: new Date(),
                    updatedAt: new Date()
                };

                const result = permissionVerifier.couldPermissionMatchQuery(userAddresses, permission, {
                    address: testContractAddress,
                    topics: [null, pad(otherAddress)]
                });

                expect(result).toBe(false);
            });

            it('query with null topic (wildcard) matches userAddress permission', () => {
                const permission = {
                    id: '1',
                    contractAddress: testContractAddress,
                    topic0Constant: null,
                    topic1Constant: null,
                    topic1ConditionType: topicConditionEnum.enum.userAddress,
                    topic2Constant: null,
                    topic2ConditionType: null,
                    topic3Constant: null,
                    topic3ConditionType: null,
                    organizationOnly: true,
                    createdAt: new Date(),
                    updatedAt: new Date()
                };

                const result = permissionVerifier.couldPermissionMatchQuery(userAddresses, permission, {
                    address: testContractAddress,
                    topics: [null, null]
                });

                expect(result).toBe(true);
            });

            it('query with topic array containing user wallet is compatible', () => {
                const nonUserAddress = pad('0xffff', { size: 20 });
                const permission = {
                    id: '1',
                    contractAddress: testContractAddress,
                    topic0Constant: null,
                    topic1Constant: null,
                    topic1ConditionType: topicConditionEnum.enum.userAddress,
                    topic2Constant: null,
                    topic2ConditionType: null,
                    topic3Constant: null,
                    topic3ConditionType: null,
                    organizationOnly: true,
                    createdAt: new Date(),
                    updatedAt: new Date()
                };

                const result = permissionVerifier.couldPermissionMatchQuery(userAddresses, permission, {
                    address: testContractAddress,
                    topics: [null, [pad(nonUserAddress), pad(userAddresses[0])]]
                });

                expect(result).toBe(true);
            });
        });

        describe('topic matching - none (wildcard) condition', () => {
            it('permission without topic condition matches any query topic', () => {
                const permission = {
                    id: '1',
                    contractAddress: testContractAddress,
                    topic0Constant: null,
                    topic1Constant: null,
                    topic1ConditionType: null,
                    topic2Constant: null,
                    topic2ConditionType: null,
                    topic3Constant: null,
                    topic3ConditionType: null,
                    organizationOnly: true,
                    createdAt: new Date(),
                    updatedAt: new Date()
                };

                const result = permissionVerifier.couldPermissionMatchQuery([], permission, {
                    address: testContractAddress,
                    topics: [pad('0xabc'), pad('0xdef')]
                });

                expect(result).toBe(true);
            });
        });

        describe('combined matching', () => {
            it('must match both address and all topics to be compatible', () => {
                const permission = {
                    id: '1',
                    contractAddress: testContractAddress,
                    topic0Constant: transferEventSelector,
                    topic1Constant: null,
                    topic1ConditionType: topicConditionEnum.enum.userAddress,
                    topic2Constant: null,
                    topic2ConditionType: null,
                    topic3Constant: null,
                    topic3ConditionType: null,
                    organizationOnly: true,
                    createdAt: new Date(),
                    updatedAt: new Date()
                };

                // Matching address, matching topic0, matching topic1 (user address)
                expect(
                    permissionVerifier.couldPermissionMatchQuery(userAddresses, permission, {
                        address: testContractAddress,
                        topics: [transferEventSelector, pad(userAddresses[0])]
                    })
                ).toBe(true);

                // Wrong address
                expect(
                    permissionVerifier.couldPermissionMatchQuery(userAddresses, permission, {
                        address: pad('0x99', { size: 20 }),
                        topics: [transferEventSelector, pad(userAddresses[0])]
                    })
                ).toBe(false);

                // Wrong topic0
                expect(
                    permissionVerifier.couldPermissionMatchQuery(userAddresses, permission, {
                        address: testContractAddress,
                        topics: [pad('0xdead'), pad(userAddresses[0])]
                    })
                ).toBe(false);

                // Wrong topic1 (not user's address)
                expect(
                    permissionVerifier.couldPermissionMatchQuery(userAddresses, permission, {
                        address: testContractAddress,
                        topics: [transferEventSelector, pad('0xffff', { size: 20 })]
                    })
                ).toBe(false);
            });
        });
    });
});
