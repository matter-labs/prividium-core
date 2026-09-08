import { bootFromCli } from './index';

/** Separate from `index.ts` so that module can be imported without booting a server. */
bootFromCli();
