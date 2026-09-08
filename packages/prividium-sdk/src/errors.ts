export class PrividiumSessionError extends Error {
    constructor() {
        super('No session started or previous session expired. Please call authorize() first.');
    }
}
