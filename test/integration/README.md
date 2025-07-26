# Integration Tests V2

This directory contains a simplified rewrite of the integration tests, designed to be clearer, more maintainable, and properly test all governance permutations.

## Design Principles

1. **Mirror SystemDeployer's test structure** - One test file per governance configuration type
2. **Simple, focused helpers** - Each helper does one thing well
3. **No duplicate tests** - Each scenario tested once in the most appropriate place
4. **Clear test names** - Describe exactly what's being tested
5. **Document limitations** - Skip tests that hit architectural constraints with clear reasons

## Test Organization

```
integration-v2/
├── single-token-governance/
│   ├── erc20-governance.test.ts          ✅ Complete (24 tests)
│   ├── erc721-governance.test.ts         ✅ Complete (29 tests)
│   ├── hats-governance.test.ts           ✅ Complete (25 tests)
│   └── locked-token-governance.test.ts   ✅ Complete (23 tests)
├── multi-token-governance/
│   ├── multiple-erc20.test.ts            ✅ Complete (21 tests)
│   ├── erc20-erc721-mixed.test.ts        ✅ Complete (27 tests)
│   └── multiple-erc721.test.ts           ✅ Complete (25 tests)
├── multisig-governance/
│   ├── basic-multisig.test.ts            ✅ Complete (13 tests)
│   └── multisig-with-modules.test.ts     ✅ Complete (13 tests)
├── parent-child/
│   ├── basic-parent-child.test.ts        📋 TODO
│   └── parent-child-freeze.test.ts       📋 TODO
├── freeze-mechanisms/
│   ├── freeze-multisig-multisig.test.ts  ✅ Complete (19 tests)
│   ├── freeze-multisig-azorius.test.ts   🔧 Created (10 tests) - needs fixing
│   ├── freeze-azorius-multisig.test.ts   🔧 Created (9 tests) - needs fixing
│   ├── freeze-azorius-azorius.test.ts    🔧 Created (13 tests) - needs fixing
│   └── freeze-standalone.test.ts         ✅ Complete (19 tests)
└── shared/
    └── helpers.ts                         ✅ Complete
```

## Key Improvements

### 1. Simplified Deployment Helper

Instead of complex `createDAOParams` with 10+ parameters, we have focused helpers:

```typescript
deployERC20DAO({
  infrastructure,
  owners: [alice.address],
  threshold: 1,
  tokenName: 'Test Token',
  tokenSymbol: 'TEST',
  tokenAllocations: [...],
  proposerThreshold: ethers.parseEther('10'),
  votingPeriod: 3600,
  quorumThreshold: ethers.parseEther('100'),
  basisNumerator: 500000n,
  timelockPeriod: 1800,
  executionPeriod: 86400,
});
```

### 2. Self-Contained Test Infrastructure

Each test file deploys its own infrastructure, making tests independent and easier to understand.

### 3. Clear Return Types

```typescript
interface DeployedERC20DAO {
  safeAddress: string;
  safe: Safe;
  token: VotesERC20V1;
  azorius: ModuleAzoriusV1;
  strategy: StrategyV1;
  proposerAdapterAddress: string;
}
```

## Architectural Limitations

These are documented as we discover them and tests are skipped with clear reasons:

1. **VoteTracker Authorization** - VoteTrackers only accept calls from their Strategy
2. **Strategy Immutability** - Strategy parameters cannot be changed after deployment
3. **Cross-DAO Voting** - DAOs cannot vote on other DAOs' proposals

## Progress

- [x] Create directory structure
- [x] Write shared helpers infrastructure
- [x] Complete single-token tests (101 tests total)
  - [x] ERC20 governance (24 tests)
  - [x] ERC721 governance (29 tests)
  - [x] Hats governance (25 tests)
  - [x] Locked token governance (23 tests)
- [x] Complete multi-token tests (73 tests total)
  - [x] Multiple ERC20 tokens (21 tests)
  - [x] Mixed ERC20 + ERC721 (27 tests)
  - [x] Multiple ERC721 collections (25 tests)
- [x] Complete multisig tests (26 tests total)
  - [x] Basic multisig (13 tests)
  - [x] Multisig with modules (13 tests)
- [ ] Complete parent-child tests
- [ ] Complete freeze mechanism tests
  - [x] Freeze standalone (19 tests)
  - [x] Freeze multisig-multisig (19 tests)
  - [ ] Remaining parent-child freeze permutations

## Test Coverage Summary

**Total Tests Completed: 238**

### Single-Token Governance

- **ERC20**: Token-based voting with delegation, proposer thresholds, quorum/basis calculations
- **ERC721**: NFT-based voting with specific token IDs, one vote per NFT
- **Hats**: Role-based proposal creation with token-based voting
- **Locked Token**: Staked token governance with VotesERC20StakedV1, minimum staking periods, reward distribution

### Multi-Token Governance

- **Multiple ERC20**: Multiple proposer adapters and voting configs with different ERC20 tokens
- **Mixed ERC20+ERC721**: Combined voting power across fungible and non-fungible tokens
- **Multiple ERC721**: Multiple NFT collections with different voting weights per collection

### Multisig Governance

- **Basic Multisig**: Pure Safe multisig without voting modules, direct owner signatures
- **Multisig with Modules**: Hybrid governance combining multisig control with token-based voting

### Key Features Tested

- Proposer adapter eligibility checks
- Multi-asset voting with different configurations
- Quorum and basis calculations across asset types
- Edge cases: exact thresholds, asset transfers, zero balances
- Full governance lifecycle: propose → vote → timelock → execute
- Error conditions and invalid operations

### Freeze Mechanisms

The freeze mechanism tests cover parent-child DAO relationships with different governance types:

**Freeze Guards** (installed on child DAOs):
- `FreezeGuardMultisigV1` - For child DAOs that are multisig Safes
- `FreezeGuardAzoriusV1` - For child DAOs with Azorius modules

**Freeze Voting** (installed on parent DAOs):
- `FreezeVotingMultisigV1` - For parent DAOs that are multisig Safes
- `FreezeVotingAzoriusV1` - For parent DAOs with Azorius modules

**Test Permutations**:
1. `freeze-multisig-multisig.test.ts` - Parent multisig freezing child multisig
2. `freeze-multisig-azorius.test.ts` - Parent multisig freezing child with Azorius
3. `freeze-azorius-multisig.test.ts` - Parent with Azorius freezing child multisig
4. `freeze-azorius-azorius.test.ts` - Parent with Azorius freezing child with Azorius

**Standalone Freeze**:
- `freeze-standalone.test.ts` - Token-based freeze voting for multisig Safes without parent-child structure
