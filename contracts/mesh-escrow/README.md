# mesh-escrow

Testnet escrow for Mesh orders. Settles in native testnet NEAR. NEAR Intents has no testnet, so it is not used here.

## Roles

| Role | Who | Can |
| --- | --- | --- |
| Owner | `vitalant5887.testnet` (a human wallet) | Fund orders, set or revoke the operator mandate, refund, freeze, unfreeze |
| Operator | The Mesh server, through a function-call key on the contract account | Release milestone payouts to the supplier fixed at funding, within the daily cap and before expiry; freeze |

The operator key is a function-call key limited to `release_milestone` and `freeze`. It cannot attach deposits, so it cannot fund anything, and it cannot call `on_release`, `refund_order`, `unfreeze` or `set_mandate`.

Every state change emits a NEP-297 event with `"standard":"mesh_escrow"`.

## Test

```bash
# In WSL
cd /mnt/c/Users/godsp/all/mesh/contracts/mesh-escrow
CARGO_TARGET_DIR=~/.cache/mesh-escrow-target cargo test
```

## Deploy to testnet

You need `cargo-near` and `near` (near-cli-rs) in WSL. Install them from NEAR's official releases:

```bash
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/cargo-near/releases/latest/download/cargo-near-installer.sh | sh
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/near-cli-rs/releases/latest/download/near-cli-rs-installer.sh | sh
```

Then, in order:

1. **Top up.** The contract account needs about 5 testnet NEAR (storage is about 1 NEAR per 100 KB of contract). Get testnet NEAR from the faucet into `vitalant5887.testnet`.

2. **Let the CLI sign as you.** This opens your wallet in the browser to approve a new key for the CLI:

   ```bash
   near account import-account using-web-wallet network-config testnet
   ```

3. **Create the contract account** `mesh.vitalant5887.testnet`, funded from your account:

   ```bash
   near account create-account fund-myself mesh.vitalant5887.testnet '5 NEAR' \
     autogenerate-new-keypair save-to-legacy-keychain \
     sign-as vitalant5887.testnet network-config testnet sign-with-legacy-keychain send
   ```

4. **Build and deploy**, setting you as owner:

   ```bash
   cd /mnt/c/Users/godsp/all/mesh/contracts/mesh-escrow
   cargo near deploy build-non-reproducible-wasm mesh.vitalant5887.testnet \
     with-init-call new json-args '{"owner":"vitalant5887.testnet"}' \
     prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
     network-config testnet sign-with-legacy-keychain send
   ```

5. **Create the operator key** (run from the repo root on Windows). It prints only the public key:

   ```bash
   node scripts/near-operator-key.mjs
   ```

6. **Add it as a restricted key** on the contract account, replacing `<PUBLIC_KEY>`:

   ```bash
   near account add-key mesh.vitalant5887.testnet \
     grant-function-call-access --allowance '1 NEAR' \
     --contract-account-id mesh.vitalant5887.testnet \
     --function-names 'release_milestone, freeze' \
     use-manually-provided-public-key <PUBLIC_KEY> \
     network-config testnet sign-with-legacy-keychain send
   ```

7. **Grant the mandate** as the owner. Example: 3 NEAR per day, expiring at a Unix time in nanoseconds:

   ```bash
   near contract call-function as-transaction mesh.vitalant5887.testnet set_mandate \
     json-args '{"operator":"mesh.vitalant5887.testnet","daily_cap":"3000000000000000000000000","expires_at":"<UNIX_NS>"}' \
     prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
     sign-as vitalant5887.testnet network-config testnet sign-with-legacy-keychain send
   ```

8. **Check it worked:**

   ```bash
   near contract call-function as-read-only mesh.vitalant5887.testnet get_config json-args '{}' network-config testnet now
   near contract call-function as-read-only mesh.vitalant5887.testnet get_mandate json-args '{}' network-config testnet now
   ```

These steps were run with near-cli-rs 0.31.1 and cargo-near 0.23.0 on 2026-11-10. MyNearWallet no longer approves new keys, so step 2 used `near account import-account using-seed-phrase network-config testnet` instead, saving to the legacy keychain. In step 7, compute `expires_at` in a script, for example `$(( ($(date +%s) + 30*86400) * 1000000000 ))`. If a command fails, run it without arguments after `near` to use the interactive prompts.
