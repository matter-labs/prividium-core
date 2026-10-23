import { execFileSync } from 'node:child_process';
import { type AbiFunction, decodeAbiParameters, encodeAbiParameters, type Hex } from 'viem';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    decodeArgumentsWithinBudget,
    MAX_ARGUMENT_CALLDATA_BYTES,
    MAX_ARGUMENT_DECODED_BYTES,
    MAX_ARGUMENT_TYPE_DEPTH,
    MAX_ARGUMENT_VALUES
} from './argument-decoding';

vi.mock('viem', async (importOriginal) => {
    const actual = await importOriginal<typeof import('viem')>();
    return { ...actual, decodeAbiParameters: vi.fn(actual.decodeAbiParameters) };
});

type Inputs = AbiFunction['inputs'];
const W = '0x1111111111111111111111111111111111111111';
const word = (value: number | bigint) => BigInt(value).toString(16).padStart(64, '0');
const calldata = (args: string): Hex => `0x12345678${args}`;
const encoded = (inputs: Inputs, values: readonly unknown[]): Hex =>
    calldata(encodeAbiParameters(inputs, values).slice(2));
const bytes = (length: number): Hex => `0x${'ab'.repeat(length)}`;
const bytesArray: Inputs = [{ type: 'bytes[]' }];
const bytesOnly: Inputs = [{ type: 'bytes' }];
const inspectInputs: Inputs = [{ type: 'address' }, { type: 'bytes[]' }];
const aliases = (counts: number[], length: number): Hex => {
    let tail = word(length) + 'ab'.repeat(length);
    for (const count of [...counts].reverse()) tail = word(count) + word(count * 32).repeat(count) + tail;
    return calldata(word(32) + tail);
};
const rejectsBeforeDecode = (inputs: Inputs, data: Hex) => {
    const decoder = vi.mocked(decodeAbiParameters);
    const implementation = decoder.getMockImplementation()!;
    // A regressed guard should fail this assertion, not exhaust the test runner's heap.
    decoder.mockClear().mockImplementation(() => {
        throw new Error('unexpected generic decode');
    });
    try {
        expect(decodeArgumentsWithinBudget(inputs, data)).toBeNull();
        expect(decoder).not.toHaveBeenCalled();
    } finally {
        decoder.mockImplementation(implementation);
    }
};
beforeEach(() => {
    vi.mocked(decodeAbiParameters).mockClear();
});
afterAll(() => {
    vi.doUnmock('viem');
});

describe('bounded argument decoding', () => {
    it('survives compact and nested aliases in a separate process with a 96 MiB old-space limit', () => {
        const moduleUrl = new URL('./argument-decoding.ts', import.meta.url).href;
        const output = execFileSync(
            process.execPath,
            [
                '--max-old-space-size=96',
                '--max-semi-space-size=8',
                '--import',
                'tsx',
                '--input-type=module',
                '--eval',
                `
            import { strict as assert } from 'node:assert';
            import { decodeArgumentsWithinBudget as decode } from ${JSON.stringify(moduleUrl)};
            const word = (value) => BigInt(value).toString(16).padStart(64, '0');
            const calldata = (body) => '0x12345678' + body;
            const compact = calldata(word(2) + word(64) + word(960) + word(959 * 32) + word(0).repeat(959));
            assert.equal(decode([{ type: 'address' }, { type: 'bytes[]' }], compact), null);
            const aliases = (counts, bytes) => {
                let tail = word(bytes) + 'ab'.repeat(bytes);
                for (const count of counts.reverse()) tail = word(count) + word(count * 32).repeat(count) + tail;
                return calldata(word(32) + tail);
            };
            assert.equal(decode([{ type: 'bytes[]' }], aliases([900], 32768)), null);
            assert.equal(decode([{ type: 'bytes[][][]' }], aliases([15, 15, 15], 6144)), null);
            assert.deepEqual(decode([{ type: 'uint256' }], calldata(word(1))), [1n]);
            process.stdout.write('ok');
            `
            ],
            { encoding: 'utf8', timeout: 15_000 }
        );
        expect(output).toBe('ok');
    });

    const canonical: Array<{ name: string; inputs: Inputs; values: readonly unknown[] }> = [
        {
            name: 'scalar words',
            inputs: [{ type: 'address' }, { type: 'uint256' }, { type: 'int64' }, { type: 'bool' }, { type: 'bytes4' }],
            values: [W, 9n, -7n, true, '0x12345678']
        },
        {
            name: 'dynamic bytes and UTF-8',
            inputs: [{ type: 'bytes' }, { type: 'string' }],
            values: ['0xabcdef', 'hello 🌍']
        },
        {
            name: 'empty dynamic values',
            inputs: [{ type: 'bytes' }, { type: 'string' }, { type: 'address[]' }],
            values: ['0x', '', []]
        },
        { name: 'address arrays', inputs: [{ type: 'address[]' }], values: [[W, W]] },
        { name: 'fixed arrays of dynamic values', inputs: [{ type: 'bytes[2]' }], values: [['0xab', '0xcdef']] },
        {
            name: 'nested dynamic and fixed arrays',
            inputs: [{ type: 'uint256[2][]' }, { type: 'bytes[][2]' }],
            values: [
                [
                    [1n, 2n],
                    [3n, 4n]
                ],
                [['0xab'], ['0xcd', '0xef']]
            ]
        },
        {
            name: 'static tuple occupies several head slots',
            inputs: [{ type: 'tuple', components: [{ type: 'uint256' }, { type: 'address' }] }, { type: 'bytes' }],
            values: [[1n, W], '0xab']
        },
        {
            name: 'named dynamic tuple',
            inputs: [
                {
                    type: 'tuple',
                    components: [
                        { name: 'who', type: 'address' },
                        { name: 'data', type: 'bytes' }
                    ]
                }
            ],
            values: [{ who: W, data: '0xab' }]
        },
        {
            name: 'tuple arrays',
            inputs: [{ type: 'tuple[]', components: [{ type: 'address' }, { type: 'string' }] }],
            values: [
                [
                    [W, 'first'],
                    [W, 'second']
                ]
            ]
        },
        {
            name: 'nested tuples',
            inputs: [
                {
                    type: 'tuple',
                    components: [
                        { type: 'tuple', components: [{ type: 'address' }, { type: 'bytes[]' }] },
                        { type: 'address[]' }
                    ]
                }
            ],
            values: [[[W, ['0xab']], [W]]]
        }
    ];
    it.each(canonical)('preserves viem results for $name', ({ inputs, values }) => {
        const data = encoded(inputs, values);
        expect(decodeArgumentsWithinBudget(inputs, data)).toEqual(decodeAbiParameters(inputs, `0x${data.slice(10)}`));
    });

    it('rejects the compact offset-table-as-bytes payload before viem can allocate', () => {
        const count = 960;
        const data = calldata(
            word(BigInt(W)) + word(64) + word(count) + word((count - 1) * 32) + word(0).repeat(count - 1)
        );
        expect((data.length - 2) / 2).toBe(30_820);
        rejectsBeforeDecode(inspectInputs, data);
    });

    it('charges a shared tail per reference, even when all offsets lie beyond the head', () => {
        const length = MAX_ARGUMENT_DECODED_BYTES / 4;
        expect(decodeArgumentsWithinBudget(bytesArray, aliases([4], length))).toEqual([Array(4).fill(bytes(length))]);
        rejectsBeforeDecode(bytesArray, aliases([5], length));
        rejectsBeforeDecode(bytesArray, aliases([900], 32 * 1024));
    });

    it('bounds nested aliases before decoding any of their repeated bytes', () => {
        const inputs: Inputs = [{ type: 'bytes[][][]' }];
        const safe = aliases([2, 3, 4], 32);
        expect(decodeArgumentsWithinBudget(inputs, safe)).toEqual(decodeAbiParameters(inputs, `0x${safe.slice(10)}`));
        rejectsBeforeDecode(inputs, aliases([15, 15, 15], 6144));
    });

    it('bounds aliased strings and dynamic tuple contents as well as byte arrays', () => {
        rejectsBeforeDecode([{ type: 'string[]' }], aliases([5], MAX_ARGUMENT_DECODED_BYTES / 4));
        const inputs: Inputs = [{ type: 'tuple[]', components: [{ type: 'address' }, { type: 'bytes' }] }];
        const data = calldata(
            word(32) +
                word(3) +
                word(96).repeat(3) +
                word(BigInt(W)) +
                word(64) +
                word(MAX_ARGUMENT_DECODED_BYTES / 2) +
                'ab'.repeat(MAX_ARGUMENT_DECODED_BYTES / 2)
        );
        rejectsBeforeDecode(inputs, data);
    });

    it('permits overlapping tails beyond the head when their full expansion fits', () => {
        const data = calldata(word(32) + word(2) + word(64) + word(96) + word(64) + word(32) + 'ab'.repeat(32));
        expect(decodeArgumentsWithinBudget(bytesArray, data)).toEqual(
            decodeAbiParameters(bytesArray, `0x${data.slice(10)}`)
        );
    });

    it('counts static values and dynamic bytes together at the exact byte budget', () => {
        const inputs: Inputs = [{ type: 'address' }, { type: 'bytes' }];
        const data = encoded(inputs, [W, bytes(MAX_ARGUMENT_DECODED_BYTES - 32)]);
        expect(decodeArgumentsWithinBudget(inputs, data)?.[0]).toBe(W);
        rejectsBeforeDecode(inputs, encoded(inputs, [W, bytes(MAX_ARGUMENT_DECODED_BYTES - 31)]));
    });

    it('bounds input conversion even when excess data is only ignored trailing bytes', () => {
        const inputs: Inputs = [{ type: 'uint256' }];
        const data = encoded(inputs, [1n]).padEnd(2 + MAX_ARGUMENT_CALLDATA_BYTES * 2, '0') as Hex;
        expect(decodeArgumentsWithinBudget(inputs, data)).toEqual([1n]);
        rejectsBeforeDecode(inputs, `${data}00`);
    });

    it('bounds value counts, including array containers', () => {
        const inputs: Inputs = [{ type: 'uint256[]' }];
        const data = encoded(inputs, [Array(MAX_ARGUMENT_VALUES - 1).fill(1n)]);
        expect((decodeArgumentsWithinBudget(inputs, data)?.[0] as unknown[]).length).toBe(MAX_ARGUMENT_VALUES - 1);
        rejectsBeforeDecode(inputs, encoded(inputs, [Array(MAX_ARGUMENT_VALUES).fill(1n)]));
    });

    it('accepts address[4095] but rejects address[4096] because the container is a value', () => {
        const data = calldata(word(BigInt(W)).repeat(MAX_ARGUMENT_VALUES - 1));
        expect(decodeArgumentsWithinBudget([{ type: `address[${MAX_ARGUMENT_VALUES - 1}]` }], data)?.[0]).toHaveLength(
            MAX_ARGUMENT_VALUES - 1
        );
        rejectsBeforeDecode(
            [{ type: `address[${MAX_ARGUMENT_VALUES}]` }],
            calldata(word(BigInt(W)).repeat(MAX_ARGUMENT_VALUES))
        );
        rejectsBeforeDecode(
            [{ type: 'uint8' }, { type: `address[${MAX_ARGUMENT_VALUES - 1}]` }],
            calldata(word(1) + data.slice(10))
        );
    });

    it('bounds arrays whose empty tuple elements consume no calldata', () => {
        expect(
            decodeArgumentsWithinBudget([{ type: 'tuple', components: [] }, { type: 'uint8' }], calldata(word(1)))
        ).toEqual([[], 1]);
        rejectsBeforeDecode([{ type: 'tuple[]', components: [] }], calldata(word(32) + word(MAX_ARGUMENT_VALUES)));
        rejectsBeforeDecode([{ type: `tuple[${MAX_ARGUMENT_VALUES}]`, components: [] }], calldata(word(0)));
        rejectsBeforeDecode([{ type: 'tuple[999999999999999999999999999999]', components: [] }], calldata(word(0)));
    });

    it('bounds type recursion independently of the payload', () => {
        let value: unknown = 1n;
        for (let i = 1; i < MAX_ARGUMENT_TYPE_DEPTH; i++) value = [value];
        const inputs: Inputs = [{ type: `uint256${'[]'.repeat(MAX_ARGUMENT_TYPE_DEPTH - 1)}` }];
        expect(decodeArgumentsWithinBudget(inputs, encoded(inputs, [value]))).toEqual([value]);
        rejectsBeforeDecode([{ type: `uint256${'[]'.repeat(MAX_ARGUMENT_TYPE_DEPTH)}` }], calldata(word(32) + word(0)));
    });

    it('bounds ABI component counts before mapping the schema', () => {
        rejectsBeforeDecode(Array(MAX_ARGUMENT_VALUES + 1).fill({ type: 'uint256' }), calldata(word(0)));
        rejectsBeforeDecode(
            [{ type: 'tuple', components: Array(MAX_ARGUMENT_VALUES).fill({ type: 'uint256' }) }],
            calldata(word(0))
        );
    });

    it('accepts exactly 4096 schema nodes even when an array has no elements', () => {
        const data = calldata(word(32) + word(0));
        // One array node, one tuple node, and 4094 scalar components.
        expect(
            decodeArgumentsWithinBudget(
                [{ type: 'tuple[]', components: Array(MAX_ARGUMENT_VALUES - 2).fill({ type: 'uint256' }) }],
                data
            )
        ).toEqual([[]]);
        rejectsBeforeDecode(
            [{ type: 'tuple[]', components: Array(MAX_ARGUMENT_VALUES - 1).fill({ type: 'uint256' }) }],
            data
        );
    });

    it('accepts exactly 4096 values including zero-byte tuple elements', () => {
        const inputs: Inputs = [{ type: 'tuple[]', components: [] }];
        // viem's cursor needs trailing data even though the elements consume zero bytes.
        expect(
            decodeArgumentsWithinBudget(inputs, calldata(word(32) + word(MAX_ARGUMENT_VALUES - 1) + word(0)))?.[0]
        ).toHaveLength(MAX_ARGUMENT_VALUES - 1);
        rejectsBeforeDecode(inputs, calldata(word(32) + word(MAX_ARGUMENT_VALUES) + word(0)));
    });

    it('leaves primitive failures after a bounded dynamic value to viem', () => {
        const inputs: Inputs = [{ type: 'bytes' }, { type: 'bool' }];
        const data = calldata(word(64) + word(2) + word(1) + 'ab'.padEnd(64, '0'));
        expect(decodeArgumentsWithinBudget(inputs, data)).toBeNull();
        expect(decodeAbiParameters).toHaveBeenCalledOnce();
    });

    it('preserves viem acceptance of unpadded dynamic bytes within the budget', () => {
        const data = calldata(`${word(32)}${word(1)}ab`);
        expect(decodeArgumentsWithinBudget(bytesOnly, data)).toEqual(['0xab']);
        expect(decodeAbiParameters).toHaveBeenCalledOnce();
    });

    it.each([
        ['root head pointer', bytesOnly, calldata(word(0))],
        ['unaligned root pointer', bytesOnly, calldata(word(33) + word(0) + word(0))],
        ['uint256 root pointer', bytesOnly, calldata(word(2n ** 255n))],
        ['truncated byte value', bytesOnly, calldata(word(32) + word(33) + word(0))],
        ['uint256 byte length', bytesOnly, calldata(word(32) + word(2n ** 255n))],
        ['uint256 array count', bytesArray, calldata(word(32) + word(2n ** 255n))],
        ['missing array heads', bytesArray, calldata(word(32) + word(2) + word(64))],
        ['array head pointer', bytesArray, calldata(word(32) + word(1) + word(0) + word(0))],
        ['unaligned element pointer', bytesArray, calldata(word(32) + word(1) + word(33) + word(0) + word(0))],
        ['uint256 element pointer', bytesArray, calldata(word(32) + word(1) + word(2n ** 255n))],
        [
            'truncated static tuple',
            [{ type: 'tuple', components: [{ type: 'address' }, { type: 'uint256' }] }],
            calldata(word(0))
        ],
        ['short selector', [], '0x1234'],
        ['odd hex length', [], '0x123456780'],
        ['invalid hex', bytesOnly, calldata(`${word(32)}${word(1)}gg`)],
        ['unsupported type', [{ type: 'function' }], calldata(word(0))],
        ['invalid integer width', [{ type: 'uint257' }], calldata(word(0))],
        ['invalid fixed bytes width', [{ type: 'bytes33' }], calldata(word(0))],
        ['zero-size fixed array', [{ type: 'address[0]' }], calldata(word(0))]
    ] as Array<[string, Inputs, Hex]>)('rejects %s before generic decoding', (_name, inputs, data) =>
        rejectsBeforeDecode(inputs, data));

    it('preserves primitive validation failures from viem', () => {
        expect(decodeArgumentsWithinBudget([{ type: 'bool' }], calldata(word(2)))).toBeNull();
        expect(decodeAbiParameters).toHaveBeenCalledOnce();
    });

    it('still applies viem recursive-read limits to aliases that pass preflight', () => {
        const result = decodeArgumentsWithinBudget([{ type: 'bytes[][]' }], aliases([63, 63], 1));
        expect(result).toBeNull();
        expect(decodeAbiParameters).toHaveBeenCalledOnce();
    });
});
