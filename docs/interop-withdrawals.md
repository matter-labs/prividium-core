# Authorize interop withdrawals

On protocol v32 and later, ZKsync SDK withdrawals use `InteropCenter.sendBundle(bytes,(bytes,bytes,bytes[])[],bytes[])`
at `0x000000000000000000000000000000000001000d` (selector `0x5ef7e104`). A permission for the older
`L2BaseToken.withdraw(address)` method does not authorize this call. Missing permission causes `eth_estimateGas` to
return `-32001: Forbidden` before a withdrawal can be submitted.

The permissions API registers InteropCenter and its `sendBundle` ABI at startup. Registration does not grant access;
function permissions remain managed by the zone operator and survive subsequent registry syncs.

After deploying this version and restarting the permissions API:

1. Confirm InteropCenter appears in the system-contract list.
2. Create or select a dedicated role for the withdrawal operator and assign it to the user associated with the watchdog
   wallet.
3. As a zone administrator, create a permission through `POST /contract-permissions` using the following body, replacing
   `<withdrawal-role-id>` with that role's ID:

   ```json
   {
     "contractAddress": "0x000000000000000000000000000000000001000d",
     "functionSignature": "function sendBundle(bytes,(bytes,bytes,bytes[])[],bytes[]) payable returns (bytes32)",
     "methodSelector": "0x5ef7e104",
     "accessType": "write",
     "ruleType": "checkRole",
     "roles": [{ "id": "<withdrawal-role-id>" }],
     "isUmbrella": false
   }
   ```

4. Verify that the watchdog can estimate and submit its withdrawal, then that withdrawal finalization resumes.

`sendBundle` is a general bundle entrypoint. A role grant authorizes that method's bundle calls; it does not reproduce
an older `withdraw(address)` rule that restricts the recipient to the caller. The recipient is nested inside the bundle
payload, and top-level address argument restrictions cannot express that condition. Assign the role to the intended
operators rather than copying an old recipient restriction or automatically making the method public. This registration
does not change inner-call policies or grant access to other InteropCenter methods.
