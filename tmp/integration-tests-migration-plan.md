# Integration Tests Completion Plan

## Project Overview

This project involves completing the integration test suite update to accommodate the new voting architecture in the Fractal contracts. The VotingAdapter contracts have been replaced with separate VoteTracker and VotingWeight contracts.

## Current State

- **Branch**: `integration-tests`
- **Total Tests Status**: 1009 passing / 121 failing
- **Integration Tests**: ~32 passing / ~121 failing (estimated from working test suites)
- **Main Issue**: Most integration tests still reference old VotingAdapter architecture

### Tests Status by Category:

| Test Suite                  | Status      | Passing | Failing |
| --------------------------- | ----------- | ------- | ------- |
| **Single Token Governance** |
| ERC20 Governance            | ✅ COMPLETE | 14      | 0       |
| ERC721 Governance           | ❌ FAILING  | 0       | 8       |
| Hats Governance             | ❌ FAILING  | 0       | 10      |
| Locked Token Governance     | ❌ FAILING  | 0       | 12      |
| **Multi Token Governance**  |
| Mixed Token Types           | ❌ FAILING  | 0       | 14      |
| Multiple ERC20              | ❌ FAILING  | 0       | 8       |
| **Other Tests**             |
| Countersign                 | ✅ COMPLETE | 17      | 0       |
| Staking Token               | ❌ FAILING  | 0       | 15      |
| Standalone Freeze           | ❌ FAILING  | 1       | 25      |
| Multisig Freeze             | ❌ FAILING  | 0       | 15      |
| Parent-Child Complex        | ❌ FAILING  | 0       | 9       |
| Parent-Child Governance     | ❌ FAILING  | 0       | 5       |

## Architecture Changes (Completed)

### Old Architecture (Removed)

- `VotingAdapterERC20V1` - Single contract for ERC20 voting
- `VotingAdapterERC721V1` - Single contract for ERC721 voting

### New Architecture (Implemented)

- **VotingWeight Contracts** (Calculate voting power):
  - `VotingWeightERC20V1` - Calculates weight from ERC20 token balance
  - `VotingWeightERC721V1` - Calculates weight from NFT ownership
- **VoteTracker Contracts** (Track votes to prevent double voting):
  - `VoteTrackerERC20V1` - One vote per address per proposal
  - `VoteTrackerERC721V1` - Tracks individual NFT usage

## Completed Work

1. ✅ **Updated Deployment Infrastructure** (`deployment.helpers.ts`)

   - Added imports for new VotingWeight and VoteTracker contracts
   - Updated DeploymentConfig interface
   - Added FreezeVotingStandaloneV1 support
   - Fixed FreezeParams structure

2. ✅ **Updated Proposal Helpers** (`proposal.helpers.ts`)

   - Changed VoteParams to use configIndex instead of votingAdapterAddress
   - Updated castVote function to use new VotingConfigVoteData structure

3. ✅ **Fixed ERC20 Governance Test**

   - Updated to use configIndex: 0 instead of votingAdapter references
   - Adjusted proxy deployment expectations (now 6 instead of 5)
   - All 14 tests passing

4. ✅ **Fixed Countersign Test**
   - Already compatible with new architecture
   - All 17 tests passing

## Current Errors Analysis

### Primary Error Pattern

The main error across failing tests is:

```
TypeError: Cannot read properties of undefined (reading 'getAddress')
```

This occurs because tests are trying to access `infrastructure.implementations.votingAdapterERC721V1` which no longer exists. The new architecture uses:

- `votingWeightERC721V1` - For calculating voting power
- `voteTrackerERC721V1` - For tracking vote usage

### Deployment Parameter Changes

Tests need to update from old VotingAdapter parameters to new VotingConfig parameters that include both VotingWeight and VoteTracker contracts.

## Remaining Work

### 1. Fix ERC721 Governance Test

**File**: `test/integration/basic-governance/single-token/erc721-governance.test.ts`

- Replace `votingAdapterERC721V1` references with `votingWeightERC721V1` and `voteTrackerERC721V1`
- Update deployment parameters to use VotingConfig structure
- Update voting to use configIndex: 0
- Update proxy deployment expectations (should be 6 proxies)
- Handle NFT-specific vote data encoding (needs token IDs)

### 2. Fix Hats Governance Test

**File**: `test/integration/basic-governance/single-token/hats-governance.test.ts`

- Update voting structure
- May need to handle Hats-specific proposer adapter

### 3. Fix Locked Token Governance Test

**File**: `test/integration/basic-governance/single-token/locked-token-governance.test.ts`

- Update voting structure
- Ensure locked token mechanics work with new architecture

### 4. Fix Multi-Token Tests

**Files**:

- `test/integration/basic-governance/multi-token/mixed-token-types.test.ts`
- `test/integration/basic-governance/multi-token/multiple-erc20.test.ts`
- Handle multiple voting configs (different configIndex values)
- Update vote aggregation logic

### 5. Fix Staking Token Test

**File**: `test/integration/erc20/staking-token-integration.test.ts`

- Update for staked token voting weight calculations
- May need special handling for staking mechanics

### 6. Fix Freeze Voting Tests

**Files**:

- `test/integration/freeze/standalone-freeze-integration.test.ts`
- `test/integration/multisig/multisig-freeze-integration.test.ts`
- Update freeze voting to work with new voting configs
- Fix parameter mismatches (likely missing arguments)

### 7. Fix Parent-Child Tests

**Files**:

- `test/integration/parent-child/complex-parent-child-scenarios.test.ts`
- `test/integration/parent-child/parent-child-governance.test.ts`
- Update parent and child DAO deployments
- Fix voting config propagation between parent/child

## Common Patterns to Apply

### 1. Replace VotingAdapter References

```typescript
// Old (INCORRECT)
const votingAdapterERC721V1Params = [
  {
    implementation: await infrastructure.implementations.votingAdapterERC721V1.getAddress(),
    token: await mockNFT.getAddress(),
    weightPerToken: 1n,
  },
];

// New (CORRECT)
const votingConfigERC721V1Params = [
  {
    votingWeightImplementation:
      await infrastructure.implementations.votingWeightERC721V1.getAddress(),
    voteTrackerImplementation:
      await infrastructure.implementations.voteTrackerERC721V1.getAddress(),
    token: await mockNFT.getAddress(),
    weightPerToken: 1n,
    // Additional params as needed
  },
];
```

### 2. Update Vote Data Structure

```typescript
// For ERC20 tokens
const voteData = ethers.AbiCoder.defaultAbiCoder().encode(
  ['tuple(uint256 configIndex)'],
  [{ configIndex: 0 }],
);

// For ERC721 tokens (needs token IDs)
const voteData = ethers.AbiCoder.defaultAbiCoder().encode(
  ['tuple(uint256 configIndex, uint256[] tokenIds)'],
  [{ configIndex: 0, tokenIds: [1, 2, 3] }], // User's NFT IDs
);
```

### 3. Update Proxy Deployment Expectations

```typescript
// Old: 5 proxies
expect(proxyDeployedEvents.length).to.equal(5);

// New: 6 proxies for single token
expect(proxyDeployedEvents.length).to.equal(6);
// Order: Token, ProposerAdapter, Strategy, VotingWeight, VoteTracker, Azorius
```

### 4. Multi-Token Voting Configs

```typescript
// For multiple voting configs (e.g., mixed ERC20 and ERC721)
const votingConfigs = [
  {
    // ERC20 config (configIndex: 0)
    votingWeightImplementation: erc20WeightImpl,
    voteTrackerImplementation: erc20TrackerImpl,
    token: erc20Token,
  },
  {
    // ERC721 config (configIndex: 1)
    votingWeightImplementation: erc721WeightImpl,
    voteTrackerImplementation: erc721TrackerImpl,
    token: nftToken,
  },
];

// When voting with different tokens
const erc20VoteData = encode(['tuple(uint256)'], [{ configIndex: 0 }]);
const erc721VoteData = encode(['tuple(uint256,uint256[])'], [{ configIndex: 1, tokenIds: [1] }]);
```

## Testing Strategy

1. Fix tests in order of complexity:

   - Single token tests first (ERC721, Hats, Locked)
   - Multi-token tests next
   - Complex scenarios last (Freeze, Parent-Child)

2. For each test file:
   - Run individually to see specific errors
   - Apply common patterns
   - Test incrementally
   - Ensure all tests in file pass before moving on

## Troubleshooting Guide

### Common Errors and Solutions

1. **TypeError: Cannot read properties of undefined (reading 'getAddress')**

   - **Cause**: Reference to non-existent `votingAdapterERC721V1` or similar
   - **Solution**: Replace with `votingWeightERC721V1` and `voteTrackerERC721V1`

2. **Wrong number of proxy deployments**

   - **Cause**: Tests expect old proxy count (5) instead of new (6+)
   - **Solution**: Update expectations based on token configs

3. **Invalid vote data encoding**

   - **Cause**: Using old adapter vote data format
   - **Solution**: Use new format with configIndex (and tokenIds for ERC721)

4. **Strategy validation errors**

   - **Cause**: Missing or incorrect voting config parameters
   - **Solution**: Ensure all required VotingConfig fields are provided

5. **Freeze voting parameter mismatches**
   - **Cause**: FreezeVotingStandaloneV1 has different constructor args
   - **Solution**: Check deployment helpers for correct parameter structure

## Success Criteria

- All 121 failing integration tests now passing
- Total test suite: 1130 passing / 0 failing
- No references to old VotingAdapter contracts
- Tests accurately reflect new voting architecture
- Code follows existing patterns and conventions

## Next Steps

1. **Immediate Priority**: Fix ERC721 governance test

   - Most similar to completed ERC20 test
   - Will establish patterns for other NFT-based tests

2. **Phase 1**: Single-token tests

   - ERC721 governance
   - Hats governance
   - Locked token governance

3. **Phase 2**: Multi-token tests

   - Multiple ERC20
   - Mixed token types

4. **Phase 3**: Complex integration tests
   - Staking token
   - Freeze voting (standalone and multisig)
   - Parent-child scenarios

## Validation Steps

After each fix:

1. Run the specific test file: `npm test test/integration/path/to/test.ts`
2. Verify no TypeScript errors: `npm run typecheck`
3. Check for lint issues: `npm run lint`
4. Run full test suite before moving to next file
