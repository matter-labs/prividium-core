import * as z from 'zod/v4';
import { selectedChain } from '../chain/selected-chain';

/** A request address in the selected chain's format, normalized to its canonical form. */
export const chainAddressSchema = z.lazy(() => selectedChain().addresses.schema);

/** A response address: checked against the selected chain's canonical form, never rewritten. */
export const storedChainAddressSchema = z.lazy(() => z.string().regex(selectedChain().addresses.pattern));
