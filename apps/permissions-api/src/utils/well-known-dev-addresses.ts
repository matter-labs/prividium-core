import { type Address, isAddressEqual } from 'viem';

/**
 * EOA addresses whose private keys are publicly known because they ship as defaults
 * with popular Ethereum development tools. Anyone can sign with these keys, so they
 * must never be associated with a Prividium user account.
 *
 * Sources are documented per group below. Every entry must be in EIP-55
 * checksummed form — enforced by the "stores every entry in EIP-55 checksummed
 * form" test, which calls `getAddress` and compares to the literal here.
 */

// Anvil / Foundry / Hardhat default accounts.
// Mnemonic: "test test test test test test test test test test test junk"
// Derivation path: m/44'/60'/0'/0/{index}
// Anvil ships the first 10 by default; Hardhat ships 20. We block all 20 because
// `--accounts N` (Anvil) and the Hardhat default both produce the same derivation.
// Refs:
//   - https://book.getfoundry.sh/anvil/
//   - https://hardhat.org/hardhat-network/docs/reference#accounts
const ANVIL_HARDHAT_FOUNDRY: readonly Address[] = [
    '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', // account 0
    '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // account 1
    '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', // account 2
    '0x90F79bf6EB2c4f870365E785982E1f101E93b906', // account 3
    '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65', // account 4
    '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc', // account 5
    '0x976EA74026E726554dB657fA54763abd0C3a0aa9', // account 6
    '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955', // account 7
    '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f', // account 8
    '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720', // account 9
    '0xBcd4042DE499D14e55001CcbB24a551F3b954096', // account 10 (Hardhat default)
    '0x71bE63f3384f5fb98995898A86B02Fb2426c5788', // account 11 (Hardhat default)
    '0xFABB0ac9d68B0B445fB7357272Ff202C5651694a', // account 12 (Hardhat default)
    '0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec', // account 13 (Hardhat default)
    '0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097', // account 14 (Hardhat default)
    '0xcd3B766CCDd6AE721141F452C550Ca635964ce71', // account 15 (Hardhat default)
    '0x2546BcD3c84621e976D8185a91A922aE77ECEc30', // account 16 (Hardhat default)
    '0xbDA5747bFD65F08deb54cb465eB87D40e51B197E', // account 17 (Hardhat default)
    '0xdD2FD4581271e230360230F9337D5c0430Bf44C0', // account 18 (Hardhat default)
    '0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199' // account 19 (Hardhat default)
];

// anvil-zksync (formerly era_test_node) documented "rich wallets".
// These ship pre-funded on the in-memory ZKsync node used by Matter Labs tooling.
// Refs:
//   - https://github.com/matter-labs/anvil-zksync
//   - https://docs.zksync.io/build/test-and-debug/in-memory-node
const ANVIL_ZKSYNC_RICH_WALLETS: readonly Address[] = [
    '0x36615Cf349d7F6344891B1e7CA7C72883F5dc049',
    '0xa61464658AfeAf65CccaaFD3a512b69A83B77618',
    '0x0D43eB5B8a47bA8900d84AA36656c92024e9772e',
    '0xA13c10C0D5bd6f79041B9835c63f91de35A15883',
    '0x8002cD98Cfb563492A6fB3E7C8243b7B9Ad4cc92',
    '0x4F9133D1d3F50011A6859807C837bdCB31Aaab13',
    '0xbd29A1B981925B94eEc5c4F1125AF02a2Ec4d1cA',
    '0xedB6F5B4aab3dD95C7806Af42881FF12BE7e9daa',
    '0xe706e60ab5Dc512C36A4646D719b889F398cbBcB',
    '0xE90E12261CCb0F3F7976Ae611A29e84a6A85f424'
];

// Ganache CLI deterministic (`-d` / `--deterministic`) default accounts.
// Mnemonic: "myth like bonus scare over problem client lounge stay quick crash boss"
// Derivation path: m/44'/60'/0'/0/{index}
// Ref: https://github.com/trufflesuite/ganache (legacy ganache-cli docs)
const GANACHE_DETERMINISTIC: readonly Address[] = [
    '0x627306090abaB3A6e1400e9345bC60c78a8BEf57',
    '0xf17f52151EbEF6C7334FAD080c5704D77216b732',
    '0xC5fdf4076b8F3A5357c5E395ab970B5B54098Fef',
    '0x821aEa9a577a9b44299B9c15c88cf3087F3b5544',
    '0x0d1d4e623D10F9FBA5Db95830F7d3839406C6AF2',
    '0x2932b7A2355D6fecc4b5c0B6BD44cC31df247a2e',
    '0x2191eF87E392377ec08E7c08Eb105Ef5448eCED5',
    '0x0F4F2Ac550A1b4e2280d04c21cEa7EBD822934b5',
    '0x6330A553Fc93768F612722BB8c2eC78aC90B3bbc',
    '0x5AEDA56215b167893e80B4fE645BA6d5Bab767DE'
];

export const WELL_KNOWN_DEV_ADDRESSES: readonly Address[] = [
    ...ANVIL_HARDHAT_FOUNDRY,
    ...ANVIL_ZKSYNC_RICH_WALLETS,
    ...GANACHE_DETERMINISTIC
];

export function isWellKnownDevAddress(address: Address): boolean {
    return WELL_KNOWN_DEV_ADDRESSES.some((known) => isAddressEqual(known, address));
}
