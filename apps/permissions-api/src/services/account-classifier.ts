import type { Address, PublicClient } from 'viem';

export class AccountClassifier {
    private client: PublicClient;

    constructor(client: PublicClient) {
        this.client = client;
    }

    async isContract(address: Address): Promise<boolean> {
        const code = await this.client.getCode({ address });
        return code !== undefined && code !== '0x';
    }
}
