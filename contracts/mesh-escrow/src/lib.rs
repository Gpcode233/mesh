//! Mesh procurement escrow.
//!
//! Roles:
//! - `owner`: a human's account. Funds orders (attaching NEAR), sets or revokes the operator mandate,
//!   refunds orders, freezes and unfreezes. Only the owner can move money into the contract.
//! - `operator`: the Mesh server, acting under a mandate. It may only release milestone payouts,
//!   only to the supplier fixed at funding time, within a daily cap and before expiry. It may freeze,
//!   but never unfreeze. Use a function-call access key for it, which cannot attach deposits.
//!
//! Every state change emits a NEP-297 event (`standard: "mesh_escrow"`).

use near_sdk::json_types::{U128, U64};
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseError};

const MAX_MILESTONES: usize = 20;
const MAX_ID_LEN: usize = 64;
const MAX_EVIDENCE_LEN: usize = 128;
const NS_PER_DAY: u64 = 86_400_000_000_000;
const CALLBACK_GAS: Gas = Gas::from_tgas(10);

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Orders,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum MilestoneStatus {
    Pending,
    /// Transfer in flight; settled to Released or back to Pending by the callback.
    Releasing,
    Released,
    Refunded,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Milestone {
    pub amount: U128,
    pub status: MilestoneStatus,
    /// Hash of the evidence that justified the release, recorded on-chain for audit.
    pub evidence_hash: Option<String>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Order {
    pub supplier: AccountId,
    pub funded_by: AccountId,
    pub milestones: Vec<Milestone>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Mandate {
    pub operator: AccountId,
    /// Maximum yoctoNEAR the operator may release per UTC day.
    pub daily_cap: U128,
    /// Block timestamp (ns) after which the mandate is void.
    pub expires_at: U64,
    pub spent_today: U128,
    /// UTC day number that `spent_today` refers to.
    pub day: u64,
}

#[near(serializers = [json])]
pub struct Config {
    pub owner: AccountId,
    pub frozen: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MeshEscrow {
    owner: AccountId,
    frozen: bool,
    mandate: Option<Mandate>,
    orders: LookupMap<String, Order>,
}

fn emit(event: &str, data: String) {
    env::log_str(&format!(
        r#"EVENT_JSON:{{"standard":"mesh_escrow","version":"1.0.0","event":"{event}","data":[{data}]}}"#
    ));
}

/// JSON-escape a value for event payloads.
fn json<T: near_sdk::serde::Serialize>(value: &T) -> String {
    near_sdk::serde_json::to_string(value).unwrap_or_else(|_| env::panic_str("event serialization failed"))
}

fn today() -> u64 {
    env::block_timestamp() / NS_PER_DAY
}

#[near]
impl MeshEscrow {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self { owner, frozen: false, mandate: None, orders: LookupMap::new(StorageKey::Orders) }
    }

    // --- Owner controls ---

    pub fn set_mandate(&mut self, operator: AccountId, daily_cap: U128, expires_at: U64) {
        self.assert_owner();
        require!(expires_at.0 > env::block_timestamp(), "Mandate expiry must be in the future");
        self.mandate = Some(Mandate { operator: operator.clone(), daily_cap, expires_at, spent_today: U128(0), day: today() });
        emit("mandate_set", format!(r#"{{"operator":{},"daily_cap":"{}","expires_at":"{}"}}"#, json(&operator), daily_cap.0, expires_at.0));
    }

    pub fn revoke_mandate(&mut self) {
        self.assert_owner();
        require!(self.mandate.take().is_some(), "No mandate to revoke");
        emit("mandate_revoked", "{}".to_string());
    }

    /// Stops all payouts. The owner or the operator (for example the Guard) may freeze.
    pub fn freeze(&mut self) {
        let caller = env::predecessor_account_id();
        require!(caller == self.owner || self.is_active_operator(&caller), "Only the owner or operator can freeze");
        self.frozen = true;
        emit("frozen", format!(r#"{{"by":{}}}"#, json(&caller)));
    }

    /// Only a human owner can resume payouts.
    pub fn unfreeze(&mut self) {
        self.assert_owner();
        self.frozen = false;
        emit("unfrozen", "{}".to_string());
    }

    /// The owner funds an order with exactly the sum of its milestones. A repeated order id is
    /// rejected, and a failed call refunds its attached deposit, so retries cannot double-fund.
    #[payable]
    pub fn fund_order(&mut self, order_id: String, supplier: AccountId, milestones: Vec<U128>) {
        self.assert_owner();
        require!(!self.frozen, "Escrow is frozen");
        require!(!order_id.is_empty() && order_id.len() <= MAX_ID_LEN, "Invalid order id");
        require!(!self.orders.contains_key(&order_id), "Order already exists");
        require!(!milestones.is_empty() && milestones.len() <= MAX_MILESTONES, "1 to 20 milestones required");
        let mut total: u128 = 0;
        for amount in &milestones {
            require!(amount.0 > 0, "Milestone amounts must be positive");
            total = total.checked_add(amount.0).unwrap_or_else(|| env::panic_str("Milestone total overflows"));
        }
        require!(env::attached_deposit().as_yoctonear() == total, "Attached deposit must equal the milestone total");

        let order = Order {
            supplier: supplier.clone(),
            funded_by: env::predecessor_account_id(),
            milestones: milestones.iter().map(|amount| Milestone { amount: *amount, status: MilestoneStatus::Pending, evidence_hash: None }).collect(),
        };
        self.orders.insert(order_id.clone(), order);
        emit("order_funded", format!(r#"{{"order_id":{},"supplier":{},"total":"{}"}}"#, json(&order_id), json(&supplier), total));
    }

    /// Returns every still-pending milestone's funds to whoever funded the order.
    pub fn refund_order(&mut self, order_id: String) -> Promise {
        self.assert_owner();
        let order = self.orders.get_mut(&order_id).unwrap_or_else(|| env::panic_str("Order not found"));
        require!(
            order.milestones.iter().all(|m| m.status != MilestoneStatus::Releasing),
            "A payout is in flight; retry after it settles"
        );
        let mut total: u128 = 0;
        for milestone in order.milestones.iter_mut().filter(|m| m.status == MilestoneStatus::Pending) {
            total += milestone.amount.0;
            milestone.status = MilestoneStatus::Refunded;
        }
        require!(total > 0, "Nothing left to refund");
        let to = order.funded_by.clone();
        emit("order_refunded", format!(r#"{{"order_id":{},"to":{},"amount":"{}"}}"#, json(&order_id), json(&to), total));
        Promise::new(to).transfer(NearToken::from_yoctonear(total))
    }

    // --- Payouts ---

    /// Pays one milestone to the order's supplier. Callable by the owner, or by the operator within
    /// its mandate. The supplier is fixed at funding time, so the operator cannot redirect funds.
    pub fn release_milestone(&mut self, order_id: String, index: u32, evidence_hash: String) -> Promise {
        require!(!self.frozen, "Escrow is frozen");
        require!(!evidence_hash.is_empty() && evidence_hash.len() <= MAX_EVIDENCE_LEN, "Evidence hash required");
        let caller = env::predecessor_account_id();
        let by_operator = caller != self.owner;

        let order = self.orders.get(&order_id).unwrap_or_else(|| env::panic_str("Order not found"));
        let milestone = order.milestones.get(index as usize).unwrap_or_else(|| env::panic_str("Milestone not found"));
        require!(milestone.status == MilestoneStatus::Pending, "Milestone is not pending");
        let amount = milestone.amount.0;
        let supplier = order.supplier.clone();

        if by_operator {
            let day = today();
            let mandate = self.mandate.as_mut().unwrap_or_else(|| env::panic_str("Caller is not the owner and no mandate is active"));
            require!(mandate.operator == caller, "Caller is not the owner or the mandated operator");
            require!(env::block_timestamp() < mandate.expires_at.0, "Mandate has expired");
            if mandate.day != day {
                mandate.day = day;
                mandate.spent_today = U128(0);
            }
            let spent = mandate.spent_today.0.checked_add(amount).unwrap_or_else(|| env::panic_str("Spend overflows"));
            require!(spent <= mandate.daily_cap.0, "Release would exceed the operator's daily cap");
            mandate.spent_today = U128(spent);
        }

        let order = self.orders.get_mut(&order_id).unwrap();
        let milestone = &mut order.milestones[index as usize];
        milestone.status = MilestoneStatus::Releasing;
        milestone.evidence_hash = Some(evidence_hash);

        Promise::new(supplier).transfer(NearToken::from_yoctonear(amount)).then(
            Self::ext(env::current_account_id())
                .with_static_gas(CALLBACK_GAS)
                .on_release(order_id, index, U128(amount), by_operator),
        )
    }

    /// Settles a release: Released on success; on failure the milestone returns to Pending and the
    /// operator's daily spend is restored, so a failed transfer never strands funds or allowance.
    #[private]
    pub fn on_release(&mut self, order_id: String, index: u32, amount: U128, by_operator: bool, #[callback_result] result: Result<(), PromiseError>) -> bool {
        let order = self.orders.get_mut(&order_id).unwrap_or_else(|| env::panic_str("Order not found"));
        let supplier = order.supplier.clone();
        let milestone = &mut order.milestones[index as usize];
        if result.is_ok() {
            milestone.status = MilestoneStatus::Released;
            let evidence = milestone.evidence_hash.clone().unwrap_or_default();
            emit("milestone_released", format!(
                r#"{{"order_id":{},"index":{},"amount":"{}","supplier":{},"evidence_hash":{}}}"#,
                json(&order_id), index, amount.0, json(&supplier), json(&evidence)
            ));
            return true;
        }
        milestone.status = MilestoneStatus::Pending;
        milestone.evidence_hash = None;
        if by_operator {
            if let Some(mandate) = self.mandate.as_mut() {
                mandate.spent_today = U128(mandate.spent_today.0.saturating_sub(amount.0));
            }
        }
        emit("milestone_release_failed", format!(r#"{{"order_id":{},"index":{}}}"#, json(&order_id), index));
        false
    }

    // --- Views ---

    pub fn get_config(&self) -> Config {
        Config { owner: self.owner.clone(), frozen: self.frozen }
    }

    pub fn get_mandate(&self) -> Option<Mandate> {
        self.mandate.clone()
    }

    pub fn get_order(&self, order_id: String) -> Option<Order> {
        self.orders.get(&order_id).cloned()
    }

    // --- Internal ---

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner can do this");
    }

    fn is_active_operator(&self, account: &AccountId) -> bool {
        self.mandate.as_ref().is_some_and(|m| &m.operator == account && env::block_timestamp() < m.expires_at.0)
    }
}

#[cfg(test)]
mod tests;
