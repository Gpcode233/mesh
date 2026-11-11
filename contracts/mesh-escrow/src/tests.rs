// Unit tests call payout methods for their state changes; the returned Promises are not executed here.
#![allow(unused_must_use)]

use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult, RuntimeFeesConfig};

const DAY: u64 = NS_PER_DAY;

fn owner() -> AccountId {
    "owner.testnet".parse().unwrap()
}
fn operator() -> AccountId {
    "mesh.owner.testnet".parse().unwrap()
}
fn supplier() -> AccountId {
    "supplier.testnet".parse().unwrap()
}
fn stranger() -> AccountId {
    "stranger.testnet".parse().unwrap()
}
fn near(n: u128) -> u128 {
    n * 10u128.pow(24)
}

fn context(caller: AccountId, deposit: u128, now: u64) -> VMContextBuilder {
    let mut builder = VMContextBuilder::new();
    builder
        .current_account_id("escrow.testnet".parse().unwrap())
        .predecessor_account_id(caller)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(now);
    builder
}

fn act(caller: AccountId, deposit: u128, now: u64) {
    testing_env!(context(caller, deposit, now).build());
}

/// Runs the release callback as the contract itself with the given transfer outcome.
fn settle(contract: &mut MeshEscrow, order_id: &str, index: u32, amount: u128, by_operator: bool, success: bool, now: u64) -> bool {
    let outcome = if success { PromiseResult::Successful(vec![]) } else { PromiseResult::Failed };
    testing_env!(
        context("escrow.testnet".parse().unwrap(), 0, now).build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![outcome]
    );
    let result = if success { Ok(()) } else { Err(PromiseError::Failed) };
    contract.on_release(order_id.to_string(), index, U128(amount), by_operator, result)
}

/// A contract with one funded order of [1, 2] NEAR and a 2 NEAR/day operator mandate.
fn setup() -> MeshEscrow {
    act(owner(), 0, DAY * 10);
    let mut contract = MeshEscrow::new(owner());
    contract.set_mandate(operator(), U128(near(2)), U64(DAY * 20));
    act(owner(), near(3), DAY * 10);
    contract.fund_order("order-1".into(), supplier(), vec![U128(near(1)), U128(near(2))]);
    contract
}

fn status(contract: &MeshEscrow, index: usize) -> MilestoneStatus {
    contract.get_order("order-1".into()).unwrap().milestones[index].status.clone()
}

#[test]
fn owner_funds_an_order_and_emits_an_event() {
    let contract = setup();
    let order = contract.get_order("order-1".into()).unwrap();
    assert_eq!(order.supplier, supplier());
    assert_eq!(order.milestones.len(), 2);
    assert!(get_logs().iter().any(|log| log.contains(r#""event":"order_funded""#) && log.contains(&near(3).to_string())));
}

#[test]
#[should_panic(expected = "Attached deposit must equal the milestone total")]
fn funding_requires_the_exact_total() {
    act(owner(), 0, DAY);
    let mut contract = MeshEscrow::new(owner());
    act(owner(), near(2), DAY);
    contract.fund_order("order-1".into(), supplier(), vec![U128(near(1)), U128(near(2))]);
}

#[test]
#[should_panic(expected = "Only the owner can do this")]
fn only_the_owner_can_fund() {
    act(owner(), 0, DAY);
    let mut contract = MeshEscrow::new(owner());
    act(operator(), near(1), DAY);
    contract.fund_order("order-1".into(), supplier(), vec![U128(near(1))]);
}

#[test]
#[should_panic(expected = "Order already exists")]
fn an_order_id_cannot_be_funded_twice() {
    let mut contract = setup();
    act(owner(), near(1), DAY * 10);
    contract.fund_order("order-1".into(), supplier(), vec![U128(near(1))]);
}

#[test]
fn operator_releases_within_its_mandate_and_the_callback_settles_it() {
    let mut contract = setup();
    act(operator(), 0, DAY * 10);
    contract.release_milestone("order-1".into(), 0, "sha256:abc".into());
    assert_eq!(status(&contract, 0), MilestoneStatus::Releasing);
    assert_eq!(contract.get_mandate().unwrap().spent_today, U128(near(1)));

    assert!(settle(&mut contract, "order-1", 0, near(1), true, true, DAY * 10));
    assert_eq!(status(&contract, 0), MilestoneStatus::Released);
    assert!(get_logs().iter().any(|log| log.contains(r#""event":"milestone_released""#) && log.contains("sha256:abc")));
}

#[test]
fn a_failed_transfer_returns_the_milestone_and_the_allowance() {
    let mut contract = setup();
    act(operator(), 0, DAY * 10);
    contract.release_milestone("order-1".into(), 0, "sha256:abc".into());
    assert!(!settle(&mut contract, "order-1", 0, near(1), true, false, DAY * 10));
    assert_eq!(status(&contract, 0), MilestoneStatus::Pending);
    assert_eq!(contract.get_order("order-1".into()).unwrap().milestones[0].evidence_hash, None);
    assert_eq!(contract.get_mandate().unwrap().spent_today, U128(0));
}

#[test]
#[should_panic(expected = "Milestone is not pending")]
fn a_milestone_cannot_be_released_twice() {
    let mut contract = setup();
    act(operator(), 0, DAY * 10);
    contract.release_milestone("order-1".into(), 0, "sha256:abc".into());
    act(operator(), 0, DAY * 10);
    contract.release_milestone("order-1".into(), 0, "sha256:abc".into());
}

#[test]
#[should_panic(expected = "Release would exceed the operator's daily cap")]
fn the_operator_cannot_exceed_its_daily_cap() {
    let mut contract = setup();
    act(operator(), 0, DAY * 10);
    contract.release_milestone("order-1".into(), 0, "sha256:a".into());
    act(operator(), 0, DAY * 10);
    contract.release_milestone("order-1".into(), 1, "sha256:b".into());
}

#[test]
fn the_daily_cap_resets_the_next_day() {
    let mut contract = setup();
    act(operator(), 0, DAY * 10);
    contract.release_milestone("order-1".into(), 0, "sha256:a".into());
    act(operator(), 0, DAY * 11);
    contract.release_milestone("order-1".into(), 1, "sha256:b".into());
    assert_eq!(contract.get_mandate().unwrap().spent_today, U128(near(2)));
}

#[test]
fn the_owner_is_not_bound_by_the_operator_cap() {
    let mut contract = setup();
    act(owner(), 0, DAY * 10);
    contract.release_milestone("order-1".into(), 1, "sha256:b".into());
    assert_eq!(contract.get_mandate().unwrap().spent_today, U128(0));
}

#[test]
#[should_panic(expected = "Mandate has expired")]
fn an_expired_mandate_cannot_release() {
    let mut contract = setup();
    act(operator(), 0, DAY * 21);
    contract.release_milestone("order-1".into(), 0, "sha256:a".into());
}

#[test]
#[should_panic(expected = "Caller is not the owner or the mandated operator")]
fn strangers_cannot_release() {
    let mut contract = setup();
    act(stranger(), 0, DAY * 10);
    contract.release_milestone("order-1".into(), 0, "sha256:a".into());
}

#[test]
#[should_panic(expected = "no mandate is active")]
fn a_revoked_operator_cannot_release() {
    let mut contract = setup();
    act(owner(), 0, DAY * 10);
    contract.revoke_mandate();
    act(operator(), 0, DAY * 10);
    contract.release_milestone("order-1".into(), 0, "sha256:a".into());
}

#[test]
#[should_panic(expected = "Escrow is frozen")]
fn the_operator_can_freeze_and_then_nothing_releases() {
    let mut contract = setup();
    act(operator(), 0, DAY * 10);
    contract.freeze();
    act(owner(), 0, DAY * 10);
    contract.release_milestone("order-1".into(), 0, "sha256:a".into());
}

#[test]
#[should_panic(expected = "Only the owner can do this")]
fn only_the_owner_can_unfreeze() {
    let mut contract = setup();
    act(operator(), 0, DAY * 10);
    contract.freeze();
    contract.unfreeze();
}

#[test]
fn the_owner_can_unfreeze() {
    let mut contract = setup();
    act(owner(), 0, DAY * 10);
    contract.freeze();
    contract.unfreeze();
    assert!(!contract.get_config().frozen);
}

#[test]
fn refund_returns_only_pending_milestones() {
    let mut contract = setup();
    act(operator(), 0, DAY * 10);
    contract.release_milestone("order-1".into(), 0, "sha256:a".into());
    settle(&mut contract, "order-1", 0, near(1), true, true, DAY * 10);
    act(owner(), 0, DAY * 10);
    contract.refund_order("order-1".into());
    assert_eq!(status(&contract, 0), MilestoneStatus::Released);
    assert_eq!(status(&contract, 1), MilestoneStatus::Refunded);
    assert!(get_logs().iter().any(|log| log.contains(r#""event":"order_refunded""#) && log.contains(&near(2).to_string())));
}

#[test]
#[should_panic(expected = "A payout is in flight")]
fn refund_waits_for_in_flight_payouts() {
    let mut contract = setup();
    act(operator(), 0, DAY * 10);
    contract.release_milestone("order-1".into(), 0, "sha256:a".into());
    act(owner(), 0, DAY * 10);
    contract.refund_order("order-1".into());
}

#[test]
#[should_panic(expected = "Only the owner can do this")]
fn the_operator_cannot_refund() {
    let mut contract = setup();
    act(operator(), 0, DAY * 10);
    contract.refund_order("order-1".into());
}
