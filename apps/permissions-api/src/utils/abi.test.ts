import { type Abi, erc20Abi } from 'viem';
import { describe, expect, it } from 'vitest';
import { abiFromString, calculateFunctionSelector, findAbiFnBySelector } from './abi';
import { InvalidEntity } from './error-types';

describe('findAbiFnBySelector', () => {
    const mockAbi: Abi = [
        {
            name: 'transfer',
            type: 'function',
            stateMutability: 'nonpayable',
            inputs: [
                { name: 'to', type: 'address' },
                { name: 'amount', type: 'uint256' }
            ],
            outputs: [{ name: '', type: 'bool' }]
        },
        {
            name: 'approve',
            type: 'function',
            stateMutability: 'nonpayable',
            inputs: [
                { name: 'spender', type: 'address' },
                { name: 'amount', type: 'uint256' }
            ],
            outputs: [{ name: '', type: 'bool' }]
        },
        {
            name: 'Transfer',
            type: 'event',
            inputs: [
                { indexed: true, name: 'from', type: 'address' },
                { indexed: true, name: 'to', type: 'address' },
                { indexed: false, name: 'value', type: 'uint256' }
            ]
        },
        {
            name: 'balanceOf',
            type: 'function',
            stateMutability: 'view',
            inputs: [{ name: 'account', type: 'address' }],
            outputs: [{ name: '', type: 'uint256' }]
        }
    ];

    it('should find transfer function by selector', () => {
        const transferSelector = '0xa9059cbb'; // transfer(address,uint256)
        const result = findAbiFnBySelector(mockAbi, transferSelector);

        expect(result).toBeDefined();
        expect(result?.name).toBe('transfer');
        expect(result?.type).toBe('function');
    });

    it('should find approve function by selector', () => {
        const approveSelector = '0x095ea7b3'; // approve(address,uint256)
        const result = findAbiFnBySelector(mockAbi, approveSelector);

        expect(result).toBeDefined();
        expect(result?.name).toBe('approve');
        expect(result?.type).toBe('function');
    });

    it('should return undefined for non-existent selector', () => {
        const nonExistentSelector = '0x12345678';
        const result = findAbiFnBySelector(mockAbi, nonExistentSelector);

        expect(result).toBeUndefined();
    });

    it('should ignore non-function ABI items', () => {
        // Event selector should not match any function
        const eventSelector = '0xddf252ad'; // Transfer event selector
        const result = findAbiFnBySelector(mockAbi, eventSelector);

        expect(result).toBeUndefined();
    });

    it('should handle empty ABI', () => {
        const emptyAbi: Abi = [];
        const result = findAbiFnBySelector(emptyAbi, '0xa9059cbb');

        expect(result).toBeUndefined();
    });

    it('should handle selector with different case', () => {
        const transferSelectorUppercase = '0xA9059CBB'; // uppercase version
        const result = findAbiFnBySelector(mockAbi, transferSelectorUppercase);

        expect(result).toBeDefined();
        expect(result?.name).toBe('transfer');
    });
});

describe('calculateFunctionSelector', () => {
    it('should calculate selector for transfer function', () => {
        const signature = 'function transfer(address to, uint256 amount)';
        const selector = calculateFunctionSelector(signature);

        expect(selector).toBe('0xa9059cbb');
    });

    it('should calculate selector for approve function', () => {
        const signature = 'function approve(address spender, uint256 amount)';
        const selector = calculateFunctionSelector(signature);

        expect(selector).toBe('0x095ea7b3');
    });

    it('should calculate selector for balanceOf function', () => {
        const signature = 'function balanceOf(address account)';
        const selector = calculateFunctionSelector(signature);

        expect(selector).toBe('0x70a08231');
    });

    it('should return 0x for receive function', () => {
        const signature = 'receive() external payable';
        const selector = calculateFunctionSelector(signature);

        expect(selector).toBe('0x');
    });

    it('should handle complex function signatures', () => {
        const signature =
            'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)';
        const selector = calculateFunctionSelector(signature);

        expect(selector).toBe('0x38ed1739');
    });

    it('should handle function with no parameters', () => {
        const signature = 'function totalSupply()';
        const selector = calculateFunctionSelector(signature);

        expect(selector).toBe('0x18160ddd');
    });

    it('should handle function with tuple parameter', () => {
        const signature = 'function mint((address to, uint256 amount) params)';
        const selector = calculateFunctionSelector(signature);

        // Selector should be calculated correctly for tuple
        expect(selector).toMatch(/^0x[a-f0-9]{8}$/);
        expect(selector.length).toBe(10);
    });
});

describe('abiFromString', () => {
    it('can parse a valid abi', () => {
        const strAbi = JSON.stringify(erc20Abi);
        const parsed = abiFromString(strAbi);
        expect(parsed).toEqual(erc20Abi);
    });

    it('can parse empty abi', () => {
        const parsed = abiFromString('[]');

        expect(parsed).toEqual([]);
    });

    it('throws is not valid json', () => {
        expect(() => abiFromString('[>')).toThrow(InvalidEntity);
    });

    it('throws is not valid json', () => {
        expect(() => abiFromString('[>')).toThrow(InvalidEntity);
    });

    it('throws is invalid type', () => {
        const elem = JSON.stringify([
            {
                type: 'log', // invalid
                name: 'Approval',
                inputs: [
                    {
                        indexed: true,
                        name: 'owner',
                        type: 'address'
                    },
                    {
                        indexed: true,
                        name: 'spender',
                        type: 'address'
                    },
                    {
                        indexed: false,
                        name: 'value',
                        type: 'uint256'
                    }
                ]
            }
        ]);

        expect(() => abiFromString(elem)).toThrow(InvalidEntity);
    });

    it('throws is invalid abi structure', () => {
        const elem = JSON.stringify([
            {
                type: 'event',
                name: 'Approval',
                inputs: {
                    indexed: true,
                    name: 'owner',
                    type: 'address'
                }
            }
        ]);

        expect(() => abiFromString(elem)).toThrow(InvalidEntity);
    });
});
