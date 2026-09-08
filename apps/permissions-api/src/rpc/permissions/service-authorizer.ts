import type { AuthData } from '../../middleware/auth-data';
import { UnauthorizedRpcError } from '../errors';

// TODO: After moving logic from proxy to permissions api this
// class is totally redundant. Will be refactored and removed away soon.
export class ServiceAuthorizer {
    auth: AuthData;
    constructor(auth: AuthData) {
        this.auth = auth;
    }

    ensureIsService(): Promise<void> {
        if (this.auth.type !== 'service') {
            throw new UnauthorizedRpcError(`Expected service authentication type. Got "${this.auth.type}"`);
        }
        return Promise.resolve();
    }
}
