import type { Address, Hex } from 'viem';
import type { ExternalRpc } from '../rpc/target-rpc';

type ClassifyResponse =
    | {
          type: 'transfer-to-eoa' | 'transfer-to-contract' | 'contract-call';
          toAddress: Address;
      }
    | {
          type: 'deployment';
          toAddress: null;
      }
    | {
          type: 'empty';
          toAddress: Address | null;
      };

export class TransactionClassifier {
    private accountClassifier: ExternalRpc;

    constructor(accountClassifier: ExternalRpc) {
        this.accountClassifier = accountClassifier;
    }

    async classifyTransaction(to: Address | null, calldata: Hex, value: bigint): Promise<ClassifyResponse> {
        if (calldata === '0x' && value === 0n) {
            return { type: 'empty', toAddress: to };
        }

        if (to === null) {
            return { type: 'deployment', toAddress: null };
        }

        if (calldata === '0x' && value !== 0n) {
            const isContract = await this.accountClassifier.isContract(to);
            return { type: isContract ? 'transfer-to-contract' : 'transfer-to-eoa', toAddress: to };
        }

        return { type: 'contract-call', toAddress: to };
    }
}
