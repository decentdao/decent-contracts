# Project Plan: Arbitrary Voting Types for Azorius Governance

**Last Updated**: Fixed state separation - Strategy stores only generic governance state (timestamps, voting type address), while VotingType contracts store all vote-specific state (tallies, voters, results). This eliminates state duplication and synchronization issues.

## Executive Summary

This project aims to redesign the Azorius governance system to support arbitrary voting types beyond the current YES/NO/ABSTAIN model. The goal is to enable extensible voting mechanisms including:

- Single-result multiple choice
- Multiple-result (e.g., top 2 of 5 options get executed)
- Splitting voting weight amongst multiple options
- Future voting types through pluggable interfaces

**Note: Since no contracts are deployed to production yet, we have full freedom to redesign the architecture without backward compatibility constraints.**

## Background & Motivation

### Current State Analysis

After comprehensive codebase analysis, the YES/NO/ABSTAIN voting model is deeply embedded throughout the governance system, primarily concentrated in the Strategy contracts. This analysis documents all coupling points that must be addressed to support arbitrary voting types.

## Detailed Coupling Analysis

### Primary Coupling Points

#### 1. IStrategyV1.sol - Core Interface Coupling

**File**: `contracts/interfaces/decent/deployables/IStrategyV1.sol`

**Fixed Enum Definition:**

```solidity
// Lines 103-107
enum VoteType {
  NO,
  YES,
  ABSTAIN
}
```

**Fixed Storage Structure:**

```solidity
// Lines 83-90
struct ProposalVotingDetails {
  uint48 votingStartTimestamp;
  uint48 votingEndTimestamp;
  uint32 votingStartBlock;
  uint256 yesVotes; // ← FIXED FIELD
  uint256 noVotes; // ← FIXED FIELD
  uint256 abstainVotes; // ← FIXED FIELD
}
```

**Hardcoded Business Logic:**

- Line 26: "Quorum calculation: YES + ABSTAIN votes must meet threshold"
- Line 27: "Basis calculation: YES votes must exceed required percentage of YES + NO votes"
- Line 60: "InvalidVoteType() error for not 0=NO, 1=YES, 2=ABSTAIN"
- Line 168: "quorumThreshold\_ Minimum total voting weight (YES + ABSTAIN) required"
- Line 277: "This is the minimum total weight of YES + ABSTAIN votes required"
- Line 321: "Quorum is met when YES + ABSTAIN votes >= quorumThreshold"
- Line 332: "Basis is met when YES / (YES + NO) > basisNumerator / BASIS_DENOMINATOR"
- Line 374: "voteType\_ The type of vote (0=NO, 1=YES, 2=ABSTAIN)"
- Line 407: "voteType\_ Type of vote: 0=NO, 1=YES, 2=ABSTAIN"

**Event Coupling:**

```solidity
// Lines 118-123
event Voted(
  address indexed voter,
  uint32 indexed proposalId,
  VoteType voteType, // ← FIXED ENUM
  uint256 totalWeightCastedInTx
);
```

#### 2. StrategyV1.sol - Implementation Coupling

**File**: `contracts/deployables/strategies/StrategyV1.sol`

**Storage Layout Coupling:**

- Line 71: Comment "Minimum total weight (YES + ABSTAIN) required for quorum"
- Lines 593-595: Fixed vote counter initialization:
  ```solidity
  proposal.yesVotes = 0;
  proposal.noVotes = 0;
  proposal.abstainVotes = 0;
  ```

**Quorum Calculation Logic:**

- Line 331: Comment "Calculates quorum based on YES + ABSTAIN votes. NO votes do not contribute to quorum."
- Line 345: `uint256 totalVotesForQuorum = proposal.yesVotes + proposal.abstainVotes;`

**Basis Calculation Logic:**

- Line 352: Comment "Formula: yesVotes _ BASIS_DENOMINATOR > (yesVotes + noVotes) _ basisNumerator"
- Lines 367-368:
  ```solidity
  (proposal.yesVotes * BASIS_DENOMINATOR) >
  ((proposal.yesVotes + proposal.noVotes) * $.basisNumerator);
  ```

**Vote Processing Logic:**

- Lines 699-706: Hardcoded vote type processing:
  ```solidity
  if (voteType_ == uint8(VoteType.YES)) {
      proposal.yesVotes += totalWeightForThisVoteTransaction;
  } else if (voteType_ == uint8(VoteType.NO)) {
      proposal.noVotes += totalWeightForThisVoteTransaction;
  } else if (voteType_ == uint8(VoteType.ABSTAIN)) {
      proposal.abstainVotes += totalWeightForThisVoteTransaction;
  } else {
      revert InvalidVoteType();
  }
  ```

**Validation Logic:**

- Line 519: Comment "VoteType enum: NO=0, YES=1, ABSTAIN=2"
- Line 484: Comment "Vote type is valid (NO=0, YES=1, ABSTAIN=2)"

#### 3. Mock Contracts (Testing Infrastructure)

**File**: `contracts/mocks/MockVotingStrategy.sol`

**Same Coupling Pattern:**

- Lines 212-216: Identical vote processing logic
- Lines 242-246: Vote type validation in mock functions

### Components WITHOUT Coupling

#### ✅ Clean Components (No Changes Needed)

1. **ModuleAzoriusV1.sol** - No direct coupling to vote types
2. **Freeze Guard Contracts** - Use different voting model
3. **Freeze Voting Contracts** - Use different voting model
4. **Vote Tracker Contracts** - Only track participation, not vote types
5. **Voting Weight Contracts** - Only calculate voting power, not vote types
6. **Proposer Adapter Contracts** - Only determine proposal eligibility

### Coupling Concentration Analysis

**Primary coupling**: IStrategyV1 interface and StrategyV1 implementation
**Secondary coupling**: Mock contracts for testing
**No coupling**: All other governance components

### Complexity Assessment

The coupling is **highly concentrated** but **deeply embedded**:

1. **Interface-level coupling**: The VoteType enum and ProposalVotingDetails struct are part of the public interface
2. **Storage-level coupling**: Fixed storage layout requires migration or redesign
3. **Business logic coupling**: Quorum and basis calculations assume specific vote types
4. **Event coupling**: External systems expect specific vote type events

### Refactoring Implications

This is indeed **very complex work** because:

1. **Breaking Interface Changes**: The public interface must be redesigned
2. **Storage Migration**: The storage layout must be completely restructured
3. **Business Logic Redesign**: Core voting algorithms must be abstracted
4. **Event Compatibility**: External integrations may break

However, the concentration of coupling makes it feasible - most changes are isolated to the Strategy contracts, with other components remaining largely unchanged.

### Strategic Recommendations

1. **Focus on Strategy Layer**: The coupling is concentrated, making targeted refactoring possible
2. **Interface Abstraction**: Create pluggable voting type interfaces
3. **Storage Redesign**: Use mappings instead of fixed fields
4. **Algorithm Abstraction**: Make quorum/basis calculations configurable per voting type
5. **Event Generalization**: Design events that work for any voting type

The good news is that the modular architecture means we can redesign the Strategy layer while keeping most other components intact.

### Business Need

- DAOs require more flexible governance mechanisms beyond simple yes/no decisions
- Examples of needed functionality:
  - Choosing between multiple implementation approaches
  - Electing multiple candidates to positions
  - Allocating resources across multiple initiatives
  - Ranked choice voting for priorities
- **Extensibility**: Support for future voting types without redeploying core contracts

## Technical Analysis

### Complexity Assessment

This is **very complex work** because:

1. **Interface-level coupling**: The VoteType enum and ProposalVotingDetails struct are part of the public interface
2. **Storage-level coupling**: Fixed storage layout requires complete redesign
3. **Business logic coupling**: Quorum and basis calculations assume specific vote types
4. **Event coupling**: External systems expect specific vote type events

### Key Opportunities (No Backward Compatibility Needed!)

1. **Clean Architecture Redesign**

   - Can modify IStrategyV1 interface directly
   - Redesign vote storage from ground up
   - Create extensible voting type system

2. **Simplified Implementation**

   - No need for V2 contracts or migration paths
   - Can modify existing contracts in place
   - Cleaner, more maintainable code

3. **Optimal Design Choices**
   - Use most efficient data structures
   - Implement best patterns without legacy constraints
   - Pluggable architecture for future extensibility

## Proposed Approach: Pluggable Voting Types

### Core Architecture: Strategy Pattern with Authorized Voting Types

The solution uses a **pluggable architecture** where voting types are implemented as separate contracts that conform to a standard interface. This leverages the existing two-phase initialization pattern already established in the codebase:

1. **Deployment Order** (following existing pattern):

   - Deploy VotingType contracts
   - Deploy Strategy with basic parameters
   - Deploy VotingConfigs (if needed) with Strategy address
   - Call Strategy.initialize2() with VotingType addresses

2. **Key Design Principles**:
   - Voting types are stateful contracts (not pure functions)
   - Each voting type manages its own proposal storage
   - Strategy maintains a whitelist of authorized voting types
   - No central registry - follows existing proposer adapter pattern

### Core Design Principle: Clean State Separation

The architecture maintains a clear separation of concerns:

**Strategy Stores (Generic Governance State):**

- `votingStartTimestamp` - When voting begins
- `votingEndTimestamp` - When voting ends
- `votingStartBlock` - For snapshot purposes
- `votingType` - Which voting type contract handles this proposal
- `quorumThreshold` - Minimum participation required (stored at strategy level)

**VotingType Stores (Vote-Specific State):**

- All vote tallies (yes/no/abstain votes, option counts, rankings)
- Voter records (who voted and how)
- Total voting power accumulated
- Winning options calculation
- Quorum/basis met status
- Any type-specific configuration (basis percentage, min thresholds, etc.)

This separation ensures:

- No state duplication between contracts
- Each contract has a single responsibility
- True modularity for adding new voting types
- No synchronization issues

### Phase 1: Core Interface Design

1. **Create IVotingType Interface (Fixed with Proper Visibility)**

   ```solidity
   interface IVotingType {
     // Removed structs - using simple return values for cleaner interface

     // Initialize storage for a new proposal
     function initializeProposal(uint32 proposalId, bytes calldata votingConfig) external;

     // Process a vote (called by Strategy)
     function processVote(
       uint32 proposalId,
       address voter,
       uint256 votingWeight,
       bytes calldata voteData
     ) external returns (bool isValid, uint256 totalWeight); // NOT pure - modifies state

     // Determine final results after voting ends
     function finalizeResults(
       uint32 proposalId,
       uint256 quorumThreshold
     ) external view returns (bytes32[] memory winningOptions, bool passed, bytes memory metadata);

     // Check if voter has already voted (for double-vote prevention)
     function hasVoted(uint32 proposalId, address voter) external view returns (bool);

     // Get current vote state for a proposal
     function getVoteState(uint32 proposalId) external view returns (bytes memory);

     // Get information about this voting type
     function getVotingTypeInfo()
       external
       pure
       returns (string memory name, string memory version, string memory description);
   }
   ```

2. **Voting Type Management in Strategy (Following Existing Patterns)**

   ```solidity
   // Add to StrategyStorage struct:
   struct StrategyStorage {
     // ... existing fields ...

     /** @notice Array of authorized voting type contracts */
     address[] authorizedVotingTypes;
     /** @notice Quick lookup for valid voting types */
     mapping(address votingType => bool isAuthorized) isAuthorizedVotingType;
     /** @notice Voting type used for each proposal */
     mapping(uint32 proposalId => address votingType) proposalVotingType;
   }

   // Add to IStrategyV1:
   function addAuthorizedVotingType(address votingType_) external;
   function removeAuthorizedVotingType(address votingType_) external;
   function isAuthorizedVotingType(address votingType_) external view returns (bool);
   function authorizedVotingTypes() external view returns (address[] memory);

   // Implementation following existing pattern:
   function addAuthorizedVotingType(address votingType_) public virtual override onlyStrategyAdmin {
     if (votingType_ == address(0)) revert InvalidAddress();

     StrategyStorage storage $ = _getStrategyStorage();

     if (!$.isAuthorizedVotingType[votingType_]) {
       $.authorizedVotingTypes.push(votingType_);
     }
     $.isAuthorizedVotingType[votingType_] = true;

     emit VotingTypeAuthorizationChanged(votingType_, true);
   }
   ```

3. **Standardized Vote Data Format**

   ```solidity
   struct StandardVoteData {
     bytes32 voteTypeId; // Identifies the voting type
     bytes32 optionId; // Identifies the option(s) being voted for
     uint256 weightAllocation; // For weighted voting (0 for non-weighted)
     bytes metadata; // Additional type-specific data
   }

   library VoteDataCodec {
     function encodeSimpleVote(uint8 choice) external pure returns (bytes memory) {
       return
         abi.encode(
           StandardVoteData({
             voteTypeId: keccak256('SIMPLE_VOTE'),
             optionId: bytes32(uint256(choice)),
             weightAllocation: 0,
             metadata: ''
           })
         );
     }

     function encodeSingleChoice(uint8 option) external pure returns (bytes memory) {
       return
         abi.encode(
           StandardVoteData({
             voteTypeId: keccak256('SINGLE_CHOICE'),
             optionId: bytes32(uint256(option)),
             weightAllocation: 0,
             metadata: ''
           })
         );
     }
   }
   ```

4. **Integration with Existing Vote Validation (Light Account Support)**

   The validation service enables gasless voting through ERC-4337. Key updates needed:

   ```solidity
   // Update StrategyV1ValidatorV1 to support arbitrary voting types:
   function validateOperation(
     address,
     address lightAccountOwner_,
     address strategy_,
     bytes calldata callData_
   ) public view virtual override returns (bool) {
     if (bytes4(callData_) != IStrategyV1.castVote.selector) {
       return false;
     }

     // Decode with NEW signature: castVote(uint32, bytes, VotingConfigVoteData[], uint256)
     // Changed from (uint32, uint8, ...) to (uint32, bytes, ...)
     (
       uint32 proposalId,
       bytes memory voteData,
       IVotingTypes.VotingConfigVoteData[] memory votingConfigsData,

     ) = abi.decode(callData_[4:], (uint32, bytes, IVotingTypes.VotingConfigVoteData[], uint256));

     // Get the voting type for this proposal
     address votingType = IStrategyV1(strategy_).proposalVotingType(proposalId);

     // Check if voter has already voted using the voting type contract
     if (IVotingType(votingType).hasVoted(proposalId, lightAccountOwner_)) {
       return false;
     }

     // Validate voting weight (maintains existing pattern)
     return
       IStrategyV1(strategy_).validStrategyVote(lightAccountOwner_, proposalId, votingConfigsData);
   }
   ```

   Key changes:

   - Parse new `castVote` signature with `bytes voteData` instead of `uint8 voteType`
   - Query voting type contract for double-vote prevention
   - Remove hardcoded vote type validation (0, 1, 2)

5. **Event System for Arbitrary Voting**

   ```solidity
   // Replace the existing Voted event with a more flexible version
   event VoteCast(
     address indexed voter,
     uint32 indexed proposalId,
     address indexed votingType,
     bytes voteData,
     uint256 totalWeightCasted
   );

   // Simple helper for emitting vote events
   function _emitVoteEvent(
     address voter,
     uint32 proposalId,
     address votingType,
     bytes memory voteData,
     uint256 totalWeight
   ) internal {
     emit VoteCast(voter, proposalId, votingType, voteData, totalWeight);
   }
   ```

6. **Redesign IStrategyV1 for Pluggable Types**

   ```solidity
   interface IStrategyV1 {
     // Remove fixed VoteType enum and ProposalVotingDetails struct
     // Add new flexible proposal initialization

     function initializeProposal(
       uint32 proposalId,
       address votingType, // Which voting type contract to use
       bytes calldata votingConfig // Voting type specific configuration
     ) external;

     function castVote(
       uint32 proposalId,
       bytes calldata voteData, // Arbitrary vote data for the voting type
       VotingConfigVoteData[] calldata votingConfigsData,
       uint256 lightAccountIndex
     ) external;

     function isPassed(uint32 proposalId) external view returns (bool);
     function getWinningOptions(uint32 proposalId) external view returns (bytes32[] memory);
     function proposalVotingType(uint32 proposalId) external view returns (address);
   }
   ```

### Phase 2: Voting Type Implementations

1. **SimpleVotingType (YES/NO/ABSTAIN)**

   - Maintains current behavior for existing functionality
   - Implements IVotingType interface
   - Uses same quorum/basis calculations

2. **SingleChoiceVotingType**

   - One winner from N options
   - Plurality voting (most votes wins)
   - Supports abstain option

3. **MultiChoiceVotingType**

   - K winners from N options
   - Top-K selection algorithm
   - Configurable minimum threshold per option

4. **WeightedVotingType**
   - Split voting power across options
   - Voters allocate percentages to options
   - Proportional results

### Phase 3: Strategy Contract Redesign

1. **Modify StrategyV1 Storage**

   ```solidity
   struct ProposalVotingDetails {
     uint48 votingStartTimestamp;
     uint48 votingEndTimestamp;
     uint32 votingStartBlock;
     address votingType; // Voting type contract address
   }
   // Note: All voting-specific state (vote counts, winners, etc.)
   // is stored in the voting type contract, not here
   ```

2. **Update Vote Processing with VotingConfig Integration**

   ```solidity
   function castVote(
     uint32 proposalId_,
     bytes calldata voteData_,
     VotingConfigVoteData[] calldata votingConfigsData_,
     uint256 lightAccountIndex_
   ) public virtual override {
     // ... existing validation and voter resolution ...

     ProposalVotingDetails storage proposal = $.proposalVotingDetails[proposalId_];

     // Step 1: Calculate total voting weight using existing VotingConfigs
     uint256 totalWeight = 0;
     for (uint256 i = 0; i < votingConfigsData_.length; i++) {
       VotingConfig memory config = $.votingConfigs[votingConfigsData_[i].configIndex];

       (uint256 votingWeight, bytes memory processedData) = IVotingWeightV1(config.votingWeight)
         .calculateWeight(
           resolvedVoter,
           proposal.votingStartTimestamp,
           votingConfigsData_[i].voteData
         );

       if (votingWeight == 0) revert NoVotingWeight(votingConfigsData_[i].configIndex);

       // Record vote in tracker (prevents double voting)
       IVoteTrackerV1(config.voteTracker).recordVote(proposalId_, resolvedVoter, processedData);

       totalWeight += votingWeight;
     }

     // Step 2: Process vote through voting type
     IVotingType votingType = IVotingType(proposal.votingType);
     (bool isValid, ) = votingType.processVote(proposalId_, resolvedVoter, totalWeight, voteData_);

     require(isValid, 'Invalid vote');

     // Step 3: Emit event (no state updates in Strategy)
     _emitVoteEvent(resolvedVoter, proposalId_, address(votingType), voteData_, totalWeight);
   }
   ```

3. **Result Calculation and Proposal Status**

   ```solidity
   function isPassed(uint32 proposalId_) public view override returns (bool) {
     ProposalVotingDetails storage proposal = $.proposalVotingDetails[proposalId_];

     if (proposal.votingEndTimestamp == 0) revert ProposalNotInitialized();
     if (block.timestamp <= proposal.votingEndTimestamp) return false;

     // Always query voting type for results (no caching in Strategy)
     IVotingType votingType = IVotingType(proposal.votingType);
     (, bool passed, ) = votingType.finalizeResults(proposalId_, $.quorumThreshold);

     return passed;
   }

   function getWinningOptions(uint32 proposalId_) public view override returns (bytes32[] memory) {
     ProposalVotingDetails storage proposal = $.proposalVotingDetails[proposalId_];

     // Always query voting type for results
     IVotingType votingType = IVotingType(proposal.votingType);
     (bytes32[] memory winningOptions, , ) = votingType.finalizeResults(
       proposalId_,
       $.quorumThreshold
     );

     return winningOptions;
   }
   ```

### Phase 4: Full Azorius Integration with Multi-Winner Support

Since contracts are not in production, we can modify ModuleAzoriusV1 to support both single and multi-winner voting types. This requires significant changes but enables powerful new governance patterns.

#### Required Azorius Modifications:

1. **Enhanced Proposal Structure**:

```solidity
// Add to ModuleAzoriusStorage
struct ProposalV2 {
  uint32 timelockPeriod;
  uint32 executionPeriod;
  address strategy;
  bool isMultiOption; // Flag for proposal type
  bytes32[] optionIds; // List of all options
  mapping(bytes32 => bytes32[]) optionTxHashes; // optionId => txHashes
  mapping(bytes32 => uint32) executionCounters; // Per-option execution tracking
  bytes32[] winningOptions; // Set by strategy after voting
  bool winningOptionsSet; // Cache flag
}

// Keep legacy Proposal struct for backward compatibility during transition
```

2. **Updated Submission Functions**:

```solidity
// New multi-option submission
function submitMultiOptionProposal(
  bytes32[] calldata optionIds_,
  Transaction[][] calldata optionTransactions_, // Array of arrays
  string calldata metadata_,
  address proposerAdapter_,
  bytes calldata proposerAdapterData_,
  address votingType_,
  bytes calldata votingConfig_
) external {
  // Validate voting type supports multi-winner
  require(
    IVotingType(votingType_).supportsMultipleWinners(),
    'Voting type must support multi-winner'
  );

  // Store transactions for each option
  uint32 proposalId = $.totalProposalCount++;
  ProposalV2 storage proposal = $.proposalsV2[proposalId];

  proposal.isMultiOption = true;
  proposal.optionIds = optionIds_;

  for (uint256 i = 0; i < optionIds_.length; i++) {
    bytes32[] memory hashes = new bytes32[](optionTransactions_[i].length);
    for (uint256 j = 0; j < optionTransactions_[i].length; j++) {
      hashes[j] = getTxHash(optionTransactions_[i][j]);
    }
    proposal.optionTxHashes[optionIds_[i]] = hashes;
  }

  // Initialize voting
  $.strategy.initializeProposal(proposalId, votingType_, votingConfig_);
}

// Keep existing submitProposal for single-winner proposals
```

3. **Multi-Option Execution**:

```solidity
function executeMultiOptionProposal(
  uint32 proposalId_,
  bytes32 optionId_,
  Transaction[] calldata transactions_
) external {
  ProposalV2 storage proposal = $.proposalsV2[proposalId_];
  require(proposal.isMultiOption, 'Not a multi-option proposal');

  // Get winning options from strategy if not cached
  if (!proposal.winningOptionsSet) {
    proposal.winningOptions = $.strategy.getWinningOptions(proposalId_);
    proposal.winningOptionsSet = true;
  }

  // Verify this option won
  bool isWinner = false;
  for (uint256 i = 0; i < proposal.winningOptions.length; i++) {
    if (proposal.winningOptions[i] == optionId_) {
      isWinner = true;
      break;
    }
  }
  require(isWinner, 'Option did not win');

  // Execute transactions for this winning option
  uint32 counter = proposal.executionCounters[optionId_];
  bytes32[] storage txHashes = proposal.optionTxHashes[optionId_];

  for (uint256 i = 0; i < transactions_.length; i++) {
    require(getTxHash(transactions_[i]) == txHashes[counter + i], 'Invalid tx');
    _executeTransaction(transactions_[i]);
  }

  proposal.executionCounters[optionId_] += uint32(transactions_.length);
  emit MultiOptionExecuted(proposalId_, optionId_, transactions_);
}
```

#### Implementation Considerations:

1. **Execution Rules**:

   - Define execution order for multiple winners (by vote count? by option ID?)
   - Handle conflicting transactions (mutex options)
   - Partial execution tracking per option

2. **Gas Optimization**:

   - Use events to store option metadata off-chain
   - Lazy-load winning options from strategy
   - Consider maximum options limit

3. **State Management**:
   - Track which options have been fully/partially executed
   - Handle expiration per option or globally
   - Support querying execution status

#### Examples of Multi-Winner Use Cases:

1. **Budget Allocation**:

   - Options: Fund Project A ($50k), Fund Project B ($30k), Fund Project C ($20k)
   - Winners: A and B both pass threshold
   - Execution: Both get funded

2. **Committee Elections**:

   - Options: 10 candidates for 3 board seats
   - Winners: Top 3 by vote count
   - Execution: Add all 3 as signers

3. **Priority Voting**:
   - Options: 5 development priorities
   - Winners: Top 2 become active workstreams
   - Execution: Fund both initiatives

### Phase 5: Supporting Infrastructure Updates

#### Critical Implementation Note: Checks-Effects-Interactions Pattern

**WARNING**: The current StrategyV1 implementation violates the checks-effects-interactions pattern! Vote tallies are updated AFTER external calls to voting configs. The new implementation MUST fix this:

```solidity
function castVote(...) external {
    // 1. CHECKS - All validation first
    require(proposal.votingEndTimestamp != 0, "Not initialized");
    require(block.timestamp <= proposal.votingEndTimestamp, "Voting ended");

    // 2. EFFECTS - Update state before any external calls
    // (This is complex because we need voting weights from external contracts)

    // 3. INTERACTIONS - All external calls last
    // - Voting weight calculations
    // - Vote tracker recordings
    // - Voting type processing
}
```

### Original Phase 5: Supporting Infrastructure

1. **Vote Tracking Updates**

   - Vote trackers continue to work unchanged (they only track participation)
   - Voting types handle their own double-vote prevention
   - No changes needed to existing VoteTracker contracts

2. **Gasless Voting Support** (Detailed in section 4 above)

   - StrategyV1ValidatorV1 updated for new vote data format
   - Voting type contracts provide hasVoted() checks
   - Maintains full ERC-4337 compatibility

3. **Events and Monitoring**
   - New VoteCast event with flexible data format
   - Includes voting type address for filtering
   - Vote data in bytes format for arbitrary voting types

## Implementation Details

### Example Voting Type Implementation with Security

```solidity
// contracts/deployables/strategies/voting-types/SimpleVotingType.sol
contract SimpleVotingType is IVotingType {
  struct SimpleVotingConfig {
    uint256 basisNumerator; // Only voting-type-specific config
  }

  struct SimpleVotingData {
    uint256 yesVotes;
    uint256 noVotes;
    uint256 abstainVotes;
    mapping(address => bool) hasVoted;
    mapping(address => uint8) voterChoices; // 0=NO, 1=YES, 2=ABSTAIN
  }

  mapping(uint32 => SimpleVotingData) private proposalVotes;
  mapping(uint32 => SimpleVotingConfig) private proposalConfigs;
  mapping(uint32 => address) private proposalStrategy; // Track which strategy owns each proposal

  // Access control pattern - only the creating strategy can interact with its proposals
  modifier onlyStrategy(uint32 proposalId) {
    require(msg.sender == proposalStrategy[proposalId], 'Only strategy');
    _;
  }

  // Additional access control for authorization (deployment-time or admin-controlled)
  mapping(address => bool) public isAuthorizedStrategy;

  modifier onlyAuthorizedStrategy() {
    require(isAuthorizedStrategy[msg.sender], 'Unauthorized strategy');
    _;
  }

  function initializeProposal(
    uint32 proposalId,
    bytes calldata config
  ) external override onlyAuthorizedStrategy {
    require(proposalStrategy[proposalId] == address(0), 'Already initialized');
    proposalStrategy[proposalId] = msg.sender;

    SimpleVotingConfig memory votingConfig = abi.decode(config, (SimpleVotingConfig));
    require(
      votingConfig.basisNumerator >= 500_000 && votingConfig.basisNumerator < 1_000_000,
      'Invalid basis'
    );
    proposalConfigs[proposalId] = votingConfig;
  }

  function processVote(
    uint32 proposalId,
    address voter,
    uint256 votingWeight,
    bytes calldata voteData
  ) external override onlyStrategy(proposalId) returns (bool isValid, uint256 totalWeight) {
    uint8 choice = abi.decode(voteData, (uint8));
    require(choice <= 2, 'Invalid vote choice');
    require(votingWeight > 0, 'No voting weight');

    SimpleVotingData storage proposal = proposalVotes[proposalId];
    require(!proposal.hasVoted[voter], 'Already voted');

    // Record vote
    proposal.hasVoted[voter] = true;
    proposal.voterChoices[voter] = choice;

    if (choice == 0) {
      proposal.noVotes += votingWeight;
    } else if (choice == 1) {
      proposal.yesVotes += votingWeight;
    } else {
      proposal.abstainVotes += votingWeight;
    }

    return (true, votingWeight);
  }

  function finalizeResults(
    uint32 proposalId,
    uint256 quorumThreshold
  )
    external
    view
    override
    returns (bytes32[] memory winningOptions, bool passed, bytes memory metadata)
  {
    SimpleVotingData storage proposal = proposalVotes[proposalId];
    SimpleVotingConfig memory config = proposalConfigs[proposalId];

    // Check quorum: YES + ABSTAIN >= threshold (provided by Strategy)
    uint256 quorumVotes = proposal.yesVotes + proposal.abstainVotes;
    if (quorumVotes < quorumThreshold) {
      return false;
    }

    // Check basis: YES > required percentage of YES + NO (voting-type-specific)
    uint256 totalDecisionVotes = proposal.yesVotes + proposal.noVotes;
    if (totalDecisionVotes == 0) return false;

    bool isPassed = (proposal.yesVotes * BASIS_DENOMINATOR) >
      (totalDecisionVotes * config.basisNumerator);

    // Check quorum: YES + ABSTAIN >= threshold
    uint256 quorumVotes = proposal.yesVotes + proposal.abstainVotes;
    bool quorumMet = quorumVotes >= quorumThreshold;

    // Check basis: YES > required percentage of YES + NO
    uint256 totalDecisionVotes = proposal.yesVotes + proposal.noVotes;
    bool basisMet = totalDecisionVotes > 0 &&
      (proposal.yesVotes * BASIS_DENOMINATOR) > (totalDecisionVotes * config.basisNumerator);

    bytes32[] memory winners = new bytes32[](0);
    if (quorumMet && basisMet) {
      winners = new bytes32[](1);
      winners[0] = bytes32(uint256(1)); // YES option wins
    }

    return (
      winners,
      quorumMet && basisMet,
      abi.encode(proposal.yesVotes, proposal.noVotes, proposal.abstainVotes)
    );
  }

  function hasVoted(uint32 proposalId, address voter) external view override returns (bool) {
    return proposalVotes[proposalId].hasVoted[voter];
  }

  function getVoteState(uint32 proposalId) external view override returns (bytes memory) {
    SimpleVotingData storage proposal = proposalVotes[proposalId];
    return abi.encode(proposal.yesVotes, proposal.noVotes, proposal.abstainVotes);
  }
}
```

### Single Choice Voting Type

```solidity
// contracts/deployables/strategies/voting-types/SingleChoiceVotingType.sol
contract SingleChoiceVotingType is IVotingType {
  struct SingleChoiceConfig {
    bytes32[] optionIds; // Option identifiers for ModuleAzorius
    bool allowAbstain;
    uint256 minWinnerThreshold; // Minimum votes needed to win
  }

  struct SingleChoiceState {
    mapping(bytes32 => uint256) optionVotes;
    mapping(address => bytes32) voterChoices;
    uint256 totalVotes;
    uint256 abstainVotes;
  }

  function processVote(
    uint32 proposalId,
    address voter,
    uint256 votingWeight,
    bytes calldata voteData
  ) external override returns (bool isValid, uint256 totalWeight) {
    // This would have similar structure to SimpleVotingType
    // Load config and state from storage
    // Validate choice against allowed options
    // Update vote counts
    // Return validity and weight

    // Simplified example:
    return (true, votingWeight);
  }

  function finalizeResults(
    uint32 proposalId,
    uint256 quorumThreshold
  )
    external
    view
    override
    returns (bytes32[] memory winningOptions, bool passed, bytes memory metadata)
  {
    SingleChoiceConfig memory config = abi.decode(context.votingConfig, (SingleChoiceConfig));
    SingleChoiceState memory state = abi.decode(finalState, (SingleChoiceState));

    bytes32[] memory winners = new bytes32[](0);
    bool passed = false;

    if (state.totalVotes >= quorumThreshold) {
      bytes32 topChoice = _findTopChoice(state, config);
      if (state.optionVotes[topChoice] >= config.minWinnerThreshold) {
        winners = new bytes32[](1);
        winners[0] = topChoice;
        passed = true;
      }
    }

    return
      FinalResult({
        winningOptions: winners, // Single winner or empty
        passed: passed,
        metadata: abi.encode(state.optionVotes)
      });
  }
}
```

### Multi-Choice Voting Type (Top K Winners)

```solidity
// contracts/deployables/strategies/voting-types/MultiChoiceVotingType.sol
contract MultiChoiceVotingType is IVotingType {
  struct MultiChoiceConfig {
    bytes32[] optionIds; // Option identifiers
    uint8 numWinners; // How many winners (K)
    uint256 minOptionThreshold; // Minimum votes per option
    bool allowAbstain;
  }

  function finalizeResults(
    uint32 proposalId,
    uint256 quorumThreshold
  )
    external
    view
    override
    returns (bytes32[] memory winningOptions, bool passed, bytes memory metadata)
  {
    MultiChoiceConfig memory config = abi.decode(context.votingConfig, (MultiChoiceConfig));
    MultiChoiceState memory state = abi.decode(finalState, (MultiChoiceState));

    // Find top K options that meet threshold
    bytes32[] memory winners = _findTopKOptions(state, config, config.numWinners);

    bool passed = state.totalVotes >= context.quorumThreshold &&
      winners.length == config.numWinners;

    return
      FinalResult({
        winningOptions: winners, // In execution priority order
        passed: passed,
        metadata: abi.encode(state.optionVotes)
      });
  }
}
```

### Strategy Contract Updates

```solidity
// Modified StrategyV1 storage
struct ProposalVotingDetails {
    uint48 votingStartTimestamp;
    uint48 votingEndTimestamp;
    uint32 votingStartBlock;
    address votingType;           // Address of voting type contract
    // All voting-specific state lives in the voting type contract
}

// Modified vote casting
function castVote(
    uint32 proposalId,
    bytes calldata voteData,
    VotingConfigVoteData[] calldata votingConfigsData,
    uint256 lightAccountIndex
) external override {
    // ... existing voter resolution and validation ...

    ProposalVotingDetails storage proposal = $.proposalVotingDetails[proposalId];

    // Aggregate voting weight from all configs
    uint256 totalWeight = 0;
    for (uint256 i = 0; i < votingConfigsData.length; i++) {
        // ... existing weight calculation ...
        totalWeight += votingWeight;
    }
        proposalId: proposalId,
        quorumThreshold: $.quorumThreshold,
        totalVotingPower: proposal.totalVotingPower,
        votingConfig: proposal.votingConfig
    });

    // Process vote through voting type
    (bool isValid, ) = votingType.processVote(
        proposalId,
        resolvedVoter,
        totalWeight,
        voteData
    );

    require(isValid, "Invalid vote");

    // Emit events (no state updates in Strategy)
    _emitVoteEvents(resolvedVoter, proposalId, voteData, totalWeight);
}
```

## Risk Analysis

### Technical Risks

- **Complexity in vote counting algorithms**: Ranked choice and instant runoff require careful implementation
- **Gas costs for dynamic storage**: Multiple mappings and arrays could be expensive
- **Edge cases in multi-winner scenarios**: Ties, minimum thresholds, etc.

### Security Risks

- **Vote manipulation in weighted systems**: Ensuring weights sum correctly
- **Gaming the system**: Strategic voting in ranked/multi-choice
- **Result calculation vulnerabilities**: Integer overflow, division by zero
- **Malicious voting type contracts**: Unauthorized or compromised voting types
- **Checks-Effects-Interactions violations**: Current code updates state after external calls
- **Access control**: Ensuring only authorized strategies can initialize proposals

### Mitigation Strategies

- Implement comprehensive test suites for each voting algorithm
- Use fixed-point math for percentage calculations
- Add circuit breakers for gas-intensive operations
- Clear specification of tie-breaking rules
- **DAO-controlled voting type authorization** (only strategyAdmin can add/remove)
- **Interface compliance validation** through ERC165 support
- **Checks-Effects-Interactions pattern** (no ReentrancyGuard dependency)
- **Access control modifiers** to ensure only authorized strategies call voting types
- **Gas limit enforcement** through block gas limits
- **Input validation** on all voting type parameters

## Implementation Priorities

### Must Have (MVP)

1. **SIMPLE type** (preserve current YES/NO/ABSTAIN)
2. **SINGLE_CHOICE** (pick one from N options)
3. Basic quorum mechanics for all types
4. Single execution path per proposal

### Should Have

1. **MULTI_CHOICE** (top K winners)
2. Multiple transaction sets per option
3. Configurable quorum per proposal type

### Nice to Have

1. **WEIGHTED_CHOICE** (split voting power)
2. **RANKED_CHOICE** (preference voting)
3. Advanced tie-breaking mechanisms

## Timeline Estimate

Given the simplified approach and focus on MVP:

- **Phase 1**: 1-2 weeks (Interface design and voting type management)
- **Phase 2**: 3-4 weeks (Simple and SingleChoice voting type implementations)
- **Phase 3**: 2-3 weeks (Strategy contract updates)
- **Phase 4**: 1 week (Minimal Azorius integration)
- **Phase 5**: 1-2 weeks (Light Account validation updates)
- **Testing & Security**: 3-4 weeks (Comprehensive testing and security review)

**Total: 11-16 weeks (approximately 3-4 months)**

**Note**: Timeline reduced significantly by:

- Removing complex registry system
- Keeping existing execution model
- Focusing on single-winner MVP
- Reusing existing patterns and infrastructure

## Key Design Decisions

1. **Pluggable Architecture**: Voting types as separate contracts implementing IVotingType interface
2. **Strategy Pattern**: Each voting type handles its own logic and storage
3. **Delegation Model**: StrategyV1 delegates to voting type contracts for vote processing
4. **Flexible Storage**: Each voting type manages its own storage patterns
5. **Result Caching**: Strategy caches results for gas efficiency
6. **Extensibility**: New voting types can be added without modifying core contracts

## Advantages of This Approach

1. **Future-Proof**: New voting types can be added without system upgrades
2. **Clean Separation**: Each voting type is self-contained
3. **Gas Optimization**: Each type can optimize for its specific use case
4. **Testability**: Voting types can be tested independently
5. **Maintainability**: Changes to one voting type don't affect others

## Critical Architecture Decisions Resolved

1. **✅ Voting Type Validation**: DAO-controlled whitelist managed by strategyAdmin
2. **✅ Circular Dependencies**: Use existing two-phase initialization pattern
3. **✅ Security Model**: Access control via modifiers, checks-effects-interactions pattern
4. **✅ Event System**: New flexible VoteCast event for arbitrary voting
5. **✅ Vote Validation**: Updated Light Account validation for arbitrary vote data
6. **✅ State Management**: Each voting type manages its own proposal state
7. **✅ Strategy Management**: Voting types are added/removed by strategyAdmin
8. **✅ Execution Model**: Single-winner only (multi-winner not feasible with current architecture)
9. **⚠️ CEI Pattern**: Current implementation violates - must be fixed in new design
10. **✅ No Migration**: Confirmed - contracts not in production

## Design Decisions

### ✅ **Resolved Design Decisions**

1. **Single-Winner MVP**: Keep existing ModuleAzoriusV1 execution model
2. **Voting Type Management**: StrategyAdmin can add/remove voting types
3. **Storage Pattern**: Each voting type manages its own proposal storage
4. **Security Model**: Access control + proper checks-effects-interactions pattern
5. **Vote Weight Integration**: Reuse existing VotingConfig infrastructure
6. **No Migration Needed**: Clean redesign without backward compatibility

### ⚠️ **Open Questions for Team Discussion**

1. **Gas Limits**: What are acceptable gas limits for complex voting algorithms?
2. **Vote Changing**: Should voting types decide their own vote-changing policies?
3. **Result Finality**: When should results be considered final and cached?
4. **Default Voting Types**: Which voting types should be included in initial Strategy deployments?
5. **Failed Transaction Handling**: Should failed transactions be retryable or permanently skipped?
6. **Option ID Format**: Should option IDs be standardized or voting-type specific?

## Next Steps

1. **✅ Architecture Review Complete**: Simplified pluggable architecture following existing patterns
2. **✅ Interface Design Complete**: IVotingType interface with stateful contracts
3. **✅ Security Framework Complete**: Access control and reentrancy protection
4. **✅ MVP Scope Defined**: Single-winner voting with existing execution model
5. **Team Decisions Required**:
   - Which voting types to implement first (Simple, SingleChoice, etc.)
   - Gas limit thresholds for voting operations
   - UI/UX for different voting type interfaces
6. **Ready for Implementation**: Begin with IVotingType interface and SimpleVotingType
7. **Testing Strategy**: Focus on voting type isolation and integration tests

## Additional Integration Points Identified

- **ERC-4337 Light Account**: Gasless voting validation needs updates (see section 4)
- **Freeze Voting System**: May need integration with arbitrary voting types
- **Service Layer**: StrategyV1ValidatorV1 updates required
- **Deployment System**: Strategy deployment with voting type configuration
- **External Event Consumers**: New event format may break integrations
- **UI/Frontend**: Dynamic voting interface rendering for different voting types
- **Checks-Effects-Interactions**: Current pattern violations must be fixed
- **Gas Optimization**: External calls to voting types increase gas costs
- **Access Control**: Voting types need proper authorization patterns
- **Single-Winner Limitation**: ModuleAzorius cannot support multi-winner without major redesign

## Summary of Key Updates (Based on Code Review)

### ✅ Confirmed Accurate:

- Voting type coupling is correctly identified and isolated to Strategy contracts
- Two-phase initialization pattern exists and can be reused
- No backward compatibility constraints (contracts not in production)
- Component isolation is good - other contracts have no voting type dependencies

### 🔄 Corrected in This Update:

1. **IVotingType Interface**: Fixed to use proper state-modifying functions, not pure
2. **No ReentrancyGuard**: Removed references, focus on checks-effects-interactions
3. **Access Control**: Added detailed pattern with onlyStrategy and authorization modifiers
4. **Validation Service**: Expanded with implementation details for Light Account support
5. **Multi-Winner Analysis**: Added detailed explanation of why it's not feasible
6. **CEI Pattern Violation**: Added warning about current implementation issue

### ⚠️ Key Risks to Address:

1. **Checks-Effects-Interactions**: Current code violates this pattern - critical to fix
2. **Gas Costs**: Delegating to external contracts will increase costs
3. **Complexity**: Despite concentrated coupling, this is still complex refactoring
4. **Testing**: Comprehensive test coverage needed for each voting type
5. **Security**: Each voting type is a new attack surface
6. **Multi-Winner Edge Cases**: Conflicts, failures, and execution order need thorough testing
