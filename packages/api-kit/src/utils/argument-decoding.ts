import { type AbiFunction, decodeAbiParameters, type Hex, slice } from 'viem';

// Bound both the input conversion and the expanded result. A small encoded tail may be referenced
// many times, so the byte budget is charged for every visit, not for distinct calldata ranges.
export const MAX_ARGUMENT_CALLDATA_BYTES = 1024 * 1024;
export const MAX_ARGUMENT_DECODED_BYTES = 256 * 1024;
export const MAX_ARGUMENT_VALUES = 4096;
export const MAX_ARGUMENT_TYPE_DEPTH = 32;

type Parameter = AbiFunction['inputs'][number];
type Layout = { dynamic: boolean; headSize: number } & (
    | { kind: 'word' }
    | { kind: 'bytes' }
    | { kind: 'tuple'; children: Layout[]; contentHeadSize: number }
    | { kind: 'array'; child: Layout; count: number | null }
);

/** Bounds ABI expansion before viem allocates arrays and dynamic values. */
export function decodeArgumentsWithinBudget(inputs: AbiFunction['inputs'], calldata: Hex): readonly unknown[] | null {
    try {
        checkDecodingBudget(inputs, calldata);
        return inputs.length === 0 ? [] : decodeAbiParameters(inputs, slice(calldata, 4));
    } catch {
        return null;
    }
}

function invalid(): never {
    throw new Error('Invalid or over-budget ABI arguments');
}

function checkDecodingBudget(inputs: AbiFunction['inputs'], calldata: Hex): void {
    if (calldata.length > 2 + MAX_ARGUMENT_CALLDATA_BYTES * 2) invalid();
    if (calldata.length < 10 || calldata.length % 2 !== 0 || !/^0x[0-9a-fA-F]+$/.test(calldata)) invalid();
    const byteLength = (calldata.length - 10) / 2;
    let schemaValues = MAX_ARGUMENT_VALUES;
    const headSize = (children: Layout[]): number => {
        const size = children.reduce((sum, child) => sum + child.headSize, 0);
        if (size > MAX_ARGUMENT_CALLDATA_BYTES) invalid();
        return size;
    };

    // Fixed arrays and empty tuples can describe huge allocations from tiny calldata.
    // Compile one child layout per array, without expanding its elements.
    const layout = (parameter: Parameter, depth: number): Layout => {
        if (--schemaValues < 0 || depth > MAX_ARGUMENT_TYPE_DEPTH || parameter.type.length > 256) invalid();
        const type = parameter.type;
        const array = /^(.*)\[([0-9]*)\]$/.exec(type);
        if (array) {
            const child = layout({ ...parameter, type: array[1] } as Parameter, depth + 1);
            const count = array[2] === '' ? null : Number(array[2]);
            if (count !== null && count > MAX_ARGUMENT_VALUES) invalid();
            if (count !== null && (!Number.isSafeInteger(count) || count < 1)) invalid();
            const dynamic = count === null || child.dynamic;
            const size = dynamic ? 32 : (count ?? 0) * child.headSize;
            if (size > MAX_ARGUMENT_CALLDATA_BYTES) invalid();
            return { kind: 'array', child, count, dynamic, headSize: size };
        }
        if (type === 'tuple') {
            if (!('components' in parameter) || !Array.isArray(parameter.components)) invalid();
            if (parameter.components.length > schemaValues) invalid();
            const children = parameter.components.map((component) => layout(component, depth + 1));
            const dynamic = children.some((child) => child.dynamic);
            const contentHeadSize = headSize(children);
            return { kind: 'tuple', children, dynamic, contentHeadSize, headSize: dynamic ? 32 : contentHeadSize };
        }
        if (type === 'bytes' || type === 'string') return { kind: 'bytes', dynamic: true, headSize: 32 };
        if (type === 'address' || type === 'bool') return { kind: 'word', dynamic: false, headSize: 32 };
        const integer = /^(?:u?int)([0-9]*)$/.exec(type);
        const bits = integer && (integer[1] === '' ? 256 : Number(integer[1]));
        const bytes = /^bytes([0-9]+)$/.exec(type);
        if (
            (bits && bits >= 8 && bits <= 256 && bits % 8 === 0) ||
            (bytes && Number(bytes[1]) >= 1 && Number(bytes[1]) <= 32)
        ) {
            return { kind: 'word', dynamic: false, headSize: 32 };
        }
        return invalid();
    };
    if (inputs.length > schemaValues) invalid();
    const layouts = inputs.map((input) => layout(input, 1));

    const range = (position: number, length: number): void => {
        if (position < 0 || length < 0 || position > byteLength || length > byteLength - position) invalid();
    };
    const word = (position: number): bigint => {
        range(position, 32);
        return BigInt(`0x${calldata.slice(10 + position * 2, 10 + (position + 32) * 2)}`);
    };
    let valuesLeft = MAX_ARGUMENT_VALUES;
    let bytesLeft = MAX_ARGUMENT_DECODED_BYTES;
    const chargeBytes = (size: number): void => {
        if (size > bytesLeft) invalid();
        bytesLeft -= size;
    };

    const visit = (node: Layout, position: number, base: number, parentHeadSize: number): void => {
        if (--valuesLeft < 0) invalid();
        if (node.dynamic) {
            const offset = word(position);
            // Offsets are relative to the enclosing tuple/array head (after a dynamic array's length).
            // Offsets must be word-aligned and point beyond the enclosing head, within the input.
            if (offset < BigInt(parentHeadSize) || offset % 32n !== 0n || offset > BigInt(byteLength - base - 32))
                invalid();
            position = base + Number(offset);
        }
        if (node.kind === 'word') {
            range(position, 32);
            chargeBytes(32);
        } else if (node.kind === 'bytes') {
            const length = word(position);
            if (length > BigInt(bytesLeft)) invalid();
            if (length > BigInt(byteLength - position - 32)) invalid();
            chargeBytes(Number(length));
        } else if (node.kind === 'tuple') {
            sequence(node.children, position, node.contentHeadSize);
        } else {
            const countWord = node.count === null ? word(position) : BigInt(node.count);
            if (countWord > BigInt(valuesLeft)) invalid();
            const count = Number(countWord);
            const start = position + (node.count === null ? 32 : 0);
            const size = count * node.child.headSize;
            range(start, size);
            for (let i = 0; i < count; i++) visit(node.child, start + i * node.child.headSize, start, size);
        }
    };
    const sequence = (children: Layout[], start: number, size: number): void => {
        range(start, size);
        let position = start;
        for (const child of children) {
            visit(child, position, start, size);
            position += child.headSize;
        }
    };
    sequence(layouts, 0, headSize(layouts));
}
