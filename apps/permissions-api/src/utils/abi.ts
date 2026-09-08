import { Abi as AbiSchema } from 'abitype/zod';
import {
    type Abi,
    type AbiFunction,
    getFunctionSelector,
    type Hex,
    parseAbiItem,
    toEventSelector,
    toFunctionSelector
} from 'viem';
import { EntityNotFound, InvalidEntity } from './error-types';

export function findAbiFnBySelector(abi: Abi, selector: Hex): AbiFunction | undefined {
    // Filter out non-function types (like events or errors)
    const abiFunctions = abi.filter((item) => item.type === 'function');

    // Find the function where the calculated selector matches the target
    return abiFunctions.find((item) => getFunctionSelector(item).toLowerCase() === selector.toLowerCase());
}

export function calculateFunctionSelector(functionSignature: string): Hex {
    const abiItem = parseAbiItem(functionSignature);

    if (abiItem.type === 'receive') {
        return '0x';
    }

    return toFunctionSelector(functionSignature);
}

export function abiFromString(abiStr: string): Abi {
    let json: unknown;
    try {
        json = JSON.parse(abiStr);
    } catch (e) {
        if (e instanceof SyntaxError) {
            throw new InvalidEntity('abi should be a valid JSON.');
        }
        throw e;
    }

    const parsed = AbiSchema.safeParse(json);
    if (!parsed.success) {
        throw new InvalidEntity('invalid abi structure');
    }
    return parsed.data as Abi;
}

/**
 * Resolves the ABI function item for `selector`, preferring the contract ABI and
 * falling back to the contract's template ABI. Shared by the single-frame path
 * ({@link AuthorizationService.abiFor}) and the batched judge path: the template
 * ABI is supplied lazily via `templateAbiFallback`, so the single-frame caller
 * fetches it from the DB only on a contract-ABI miss while the batched caller
 * returns it from a prefetched map.
 *
 * Throws `EntityNotFound` when no contract ABI exists and a plain `Error` when
 * the selector is in neither ABI, matching the previous inline behavior.
 */
export async function resolveAbiItem(
    contractAbiStr: string | undefined,
    templateAbiFallback: () => string | undefined | Promise<string | undefined>,
    selector: Hex
): Promise<Abi> {
    if (contractAbiStr === undefined) {
        throw new EntityNotFound('Contract', { selector });
    }
    let abiItem = findAbiFnBySelector(abiFromString(contractAbiStr), selector);
    if (abiItem === undefined) {
        const templateAbiStr = await templateAbiFallback();
        if (templateAbiStr !== undefined) {
            abiItem = findAbiFnBySelector(abiFromString(templateAbiStr), selector);
        }
    }
    if (abiItem === undefined) {
        throw new Error('unknown method');
    }
    return [abiItem];
}

export function abiHasEventSelector(abi: Abi, eventSelector: Hex): boolean {
    return abi.filter((item) => item.type === 'event').some((event) => toEventSelector(event) === eventSelector);
}
