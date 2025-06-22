# CLAUDE.md

Documentation lives in [README.md](./README.md) @./README.md

## NatSpec Documentation Guidelines

This section provides comprehensive guidelines for writing NatSpec documentation in the Decent Contracts codebase. All contracts should follow these patterns to ensure consistency and clarity.

### Core Principles

1. **Avoid Duplication**: Use `@inheritdoc` extensively to avoid duplicating documentation between interfaces and implementations
2. **Interface First**: Comprehensive documentation belongs in interfaces; implementations should only add implementation-specific details
3. **Clarity and Precision**: Documentation should be clear, accurate, and help developers understand contract usage without reading implementation
4. **Consistent Formatting**: Follow established patterns for headers, parameters, and organization

### Contract Naming Conventions

#### Version Suffix Pattern

The codebase follows a specific pattern for version suffixes:

1. **Abstract Contracts**: Do NOT include version suffix (e.g., `BasePaymaster`, `VotingAdapterBase`, `DeploymentBlock`)

   - These are never deployed directly
   - Version changes in abstract contracts cascade to their implementations
   - Cleaner naming without redundant versioning

2. **Concrete Contracts**: DO include version suffix (e.g., `ModuleAzoriusV1`, `StrategyV1`, `DecentPaymasterV1`)

   - These are deployed contracts that may need upgrades
   - Version suffix tracks contract iterations
   - Enables multiple versions to coexist if needed

3. **Interfaces**: Follow the same pattern as their implementations
   - Abstract contract interfaces: No version suffix (e.g., `IVotingAdapterBase`)
   - Concrete contract interfaces: Include version suffix (e.g., `IModuleAzoriusV1`)

### Contract Categories and Documentation Patterns

#### 1. Interface Contracts

Interfaces contain the most comprehensive documentation as they define the contract's public API:

```solidity
/**
 * @title IContractName
 * @notice High-level one-line description of the interface's purpose
 * @dev Comprehensive explanation of the contract's role in the system.
 *
 * Key features:
 * - Feature 1 with brief explanation
 * - Feature 2 with brief explanation
 *
 * Integration requirements:
 * - Requirement 1 (e.g., "Must be registered as Safe module")
 * - Requirement 2 (e.g., "Requires specific roles for operation")
 *
 * [Additional sections as needed like "Voting mechanics:", "Security model:", etc.]
 */
```

#### 2. Implementation Contracts

Implementation contracts reference their interface and add implementation details:

```solidity
/**
 * @title ContractNameV1  // Note: Concrete contracts include V1 suffix
 * @author Decent Labs
 * @notice Implementation of IContractName providing [brief functional description]
 * @dev This contract implements IContractName, providing [what it does].
 *
 * Implementation details:
 * - Uses EIP-7201 namespaced storage pattern
 * - UUPS upgradeable with owner-restricted upgrades
 * - Integrates with [external contracts/protocols]
 * - [Other technical implementation details]
 *
 * @custom:security-contact security@decentlabs.io
 */
```

**Important**: Do NOT duplicate the comprehensive documentation from the interface.

#### 3. Abstract Contracts

Abstract contracts that provide base functionality do NOT include version suffix:

```solidity
/**
 * @title BasePaymaster  // Note: No V1 suffix for abstract contracts
 * @author Decent Labs
 * @notice Abstract base contract for paymaster implementations
 * @dev Provides core paymaster functionality that concrete implementations extend.
 *
 * Implementation details:
 * - Helper methods for staking and deposits
 * - Base validation logic
 * - Must be extended by concrete paymaster contracts
 *
 * @custom:security-contact security@decentlabs.io
 */
abstract contract BasePaymaster is IPaymaster, OwnableUpgradeable {
    // ...
}
```

#### 4. Standalone Contracts (No Interface)

For contracts without interfaces, include full documentation:

```solidity
/**
 * @title ContractName
 * @author Decent Labs
 * @notice [One-line description of the contract's purpose]
 * @dev [Detailed explanation of the contract's functionality and role]
 *
 * Key features:
 * - [List main capabilities]
 *
 * [Additional relevant sections]
 *
 * @custom:security-contact security@decentlabs.io
 */
```

### Function Documentation

#### Using @inheritdoc

For functions implementing an interface:

```solidity
/**
 * @inheritdoc IContractName
 */
function someFunction() external;

// Or with implementation details:
/**
 * @inheritdoc IContractName
 * @dev Implementation uses [specific approach/library] to achieve [goal].
 * Validates [what] before [action].
 */
```

Common inherited functions that should use @inheritdoc:

- `_authorizeUpgrade` from UUPSUpgradeable
- `transferOwnership` from Ownable
- `supportsInterface` from ERC165
- Any function defined in an interface

#### Documenting New Functions

For functions not in interfaces:

```solidity
/**
 * @notice [Brief description of what the function does]
 * @dev [Technical details, implementation notes, security considerations]
 * @param paramName_ [Description of parameter and constraints]
 * @return returnName [Description of return value]
 * @custom:throws ErrorName if [condition]
 */
```

### State Variables and Storage

#### EIP-7201 Storage Pattern

```solidity
/**
 * @notice Main storage struct for ContractName following EIP-7201
 * @dev Contains all [category] state including [what it stores]
 * @custom:storage-location erc7201:Decent.ContractName.main
 */
struct ContractStorage {
    /** @notice [What this variable tracks/represents] */
    uint256 variable1;

    /** @notice [Purpose of this mapping] */
    mapping(address => uint256) variable2;
}
```

#### Storage Getter Functions

```solidity
/**
 * @dev Returns the storage struct for ContractName
 * Following the EIP-7201 namespaced storage pattern to avoid storage collisions
 */
function _getContractStorage() internal pure returns (ContractStorage storage $) {
    // implementation
}
```

**Important**: Do NOT use `@return` tags with `$` as the parameter name - the docgen tool cannot parse this.

#### Constants

```solidity
/** @notice [What this constant represents and how it's used] */
bytes32 public constant CONSTANT_NAME = keccak256("CONSTANT_NAME");
```

### Events Documentation

```solidity
/**
 * @notice Emitted when [action that triggers the event]
 * @param account [Description of what this parameter represents]
 * @param amount [Description including any constraints or special values]
 */
event EventName(address indexed account, uint256 amount);
```

### Errors Documentation

```solidity
/** @notice Thrown when [specific condition that causes the error] */
error SimpleError();

/** @notice Thrown when [condition] with [parameter context] */
error ErrorWithContext(address account, uint256 expected, uint256 actual);
```

### Enums Documentation

```solidity
/**
 * @notice [What this enum represents]
 * @dev [How the enum is used in the contract]
 *
 * Values:
 * - VALUE1: [What this value means and when it's used]
 * - VALUE2: [What this value means and when it's used]
 */
enum Status {
    VALUE1,
    VALUE2
}
```

For state machine enums, include transition information:

```solidity
/**
 * @notice Represents the lifecycle states of a proposal
 * @dev State transitions:
 * - PENDING -> ACTIVE: When voting period begins
 * - ACTIVE -> SUCCEEDED/FAILED: Based on vote outcome
 * - SUCCEEDED -> EXECUTED: After timelock period
 *
 * Terminal states: FAILED, EXECUTED
 *
 * Values:
 * - PENDING: Proposal created but voting not started
 * - ACTIVE: Voting period is active
 * - SUCCEEDED: Proposal passed but in timelock
 * - FAILED: Proposal did not meet requirements
 * - EXECUTED: Proposal was executed successfully
 */
```

### Modifiers Documentation

```solidity
/**
 * @notice [What this modifier ensures/checks]
 * @dev [When this modifier should be used]
 * @custom:throws ErrorName if [condition]
 */
modifier onlyAuthorized() {
    // implementation
}
```

### Inline Documentation

For complex functions (>30 lines) or intricate logic:

```solidity
function complexFunction(uint256 param_) external {
    // Step 1: Validate inputs and check preconditions
    require(param_ > 0, "Invalid param");

    // Calculate weighted average using formula:
    // weightedAvg = (value1 * weight1 + value2 * weight2) / totalWeight
    uint256 weightedAvg = _calculateWeightedAverage();

    // Check if emergency override is needed
    if (emergencyMode) {
        // In emergency mode, bypass normal checks
        return _emergencyFallback(param_);
    }

    // Update state following checks-effects-interactions pattern
    lastUpdate = block.timestamp;

    // Emit event before external calls
    emit Updated(param_, weightedAvg);

    // External call last to prevent reentrancy
    externalContract.notify(param_);
}
```

### Section Headers

#### Interface Section Headers

In interfaces, use simple single-line delimiters to separate sections:

```solidity
// --- Section Name ---
```

Interface sections should be ordered as follows (if available):

1. **Errors**
2. **Structs**
3. **Enums**
4. **Events**
5. **Initializer Functions**
6. **Pure Functions**
7. **View Functions**
8. **State-Changing Functions**

Example interface structure:

```solidity
interface IExampleV1 {
    // --- Errors ---

    error InvalidInput(uint256 provided, uint256 expected);

    // --- Structs ---

    struct Config {
        uint256 threshold;
        address admin;
    }

    // --- Events ---

    event ConfigUpdated(Config newConfig);

    // --- View Functions ---

    function getConfig() external view returns (Config memory);

    // --- State-Changing Functions ---

    function updateConfig(Config calldata config_) external;
}
```

#### Contract Section Headers

In contracts, use 70-character wide section headers with centered text:

```solidity
// ======================================================================
// SECTION NAME
// ======================================================================
```

Contract sections should be ordered as follows (if available):

1. **STATE VARIABLES**
2. **MODIFIERS**
3. **CONSTRUCTOR & INITIALIZERS**
4. **[Interface/Contract Name]** - One section per inherited interface/contract
5. **INTERNAL HELPERS**

Within interface/contract sections, separate functions by visibility using the same format as interfaces:

```solidity
// ======================================================================
// IExampleV1
// ======================================================================

// --- View Functions ---

function getConfig() external view override returns (Config memory) {
    return _config;
}

// --- State-Changing Functions ---

function updateConfig(Config calldata config_) external override {
    _config = config_;
    emit ConfigUpdated(config_);
}
```

Complete contract example:

```solidity
contract ExampleV1 is IExampleV1, UUPSUpgradeable, OwnableUpgradeable {
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    Config private _config;

    // ======================================================================
    // MODIFIERS
    // ======================================================================

    modifier onlyValidConfig(Config calldata config_) {
        if (config_.threshold == 0) revert InvalidInput(0, 1);
        _;
    }

    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    function initialize(Config calldata initialConfig_) public initializer {
        __Ownable_init();
        __UUPSUpgradeable_init();
        _config = initialConfig_;
    }

    // ======================================================================
    // IExampleV1
    // ======================================================================

    // --- View Functions ---

    function getConfig() external view override returns (Config memory) {
        return _config;
    }

    // --- State-Changing Functions ---

    function updateConfig(
        Config calldata config_
    ) external override onlyOwner onlyValidConfig(config_) {
        _config = config_;
        emit ConfigUpdated(config_);
    }

    // ======================================================================
    // UUPSUpgradeable
    // ======================================================================

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ======================================================================
    // INTERNAL HELPERS
    // ======================================================================

    function _validateThreshold(uint256 threshold_) internal pure {
        if (threshold_ == 0) revert InvalidInput(threshold_, 1);
    }
}
```

### Special Considerations

#### Parameter Naming Convention

All function parameters use trailing underscore:

```solidity
function transfer(address recipient_, uint256 amount_) external;
```

#### Upgradeability Documentation

Document upgradeability ONLY in implementation contracts, not interfaces:

```solidity
/**
 * @dev This contract implements the UUPS pattern. Upgrades are restricted to
 * the contract owner. Storage layout must be preserved between upgrades.
 */
```

#### Security Tags

Always include security contact on main contracts:

```solidity
/**
 * @custom:security-contact security@decentlabs.io
 */
```

#### Deployment Patterns

Based on contract category, document deployment expectations:

- **Deployables**: "One instance deployed per DAO"
- **Singletons**: "One instance deployed per chain"
- **Utilities**: "Temporary Safe module, attached then detached per proposal"
- **Services**: "Stateless singleton service deployed once per chain"

### Common Pitfalls to Avoid

1. **Never duplicate interface documentation in implementations** - Use @inheritdoc
2. **Don't use @dev inside enum declarations** - Put it in the header comment
3. **Don't use @return with `$` parameter name** - Docgen can't parse it
4. **Don't document upgradeability in interfaces** - It's an implementation detail
5. **Don't forget IERC165 when documenting supportsInterface**
6. **Always run tests before documenting** - Ensure accuracy
7. **Don't add comments unless asked** - Let NatSpec handle documentation

### Documentation Workflow

1. **Gather Information**:

   - Read CLAUDE.md to understand contract's role
   - Read interface first (if exists)
   - Examine implementation
   - Run tests to verify behavior

2. **Write Documentation**:

   - Start with contract-level docs
   - Use @inheritdoc for interface functions
   - Document only what's not in the interface
   - Add inline comments for complex logic (>30 lines)

3. **Validate**:
   - Cross-reference with tests
   - Ensure accuracy of descriptions
   - Run `npm run docgen` to verify output

### Real Examples from Codebase

#### Example 1: Well-Documented Interface

From `IModuleAzoriusV1.sol`:

```solidity
/**
 * @title IModuleAzoriusV1
 * @notice Central governance module for DAOs using the Azorius Protocol
 * @dev This module serves as the core governance system that manages proposals and executes
 * transactions through a Gnosis Safe. It acts as a Zodiac module, enabling modular
 * governance with support for various voting strategies and token standards.
 *
 * Key features:
 * - Proposal submission with customizable proposer adapters
 * - Flexible voting through a delegated strategy contract
 * - Timelock mechanism for security
 * - Execution period constraints
 * - Safe integration for transaction execution
 *
 * The module delegates voting logic to a Strategy contract, allowing DAOs to
 * customize their voting mechanisms without modifying the core governance module.
 *
 * Integration requirements:
 * - Must be enabled as a module on the target Safe
 * - Requires a valid Strategy contract for voting
 * - Supports various proposer adapters for access control
 */
```

#### Example 2: Implementation Using @inheritdoc

From `ModuleAzoriusV1.sol`:

```solidity
/**
 * @inheritdoc IModuleAzoriusV1
 * @dev Dynamically calculates state based on current timestamp and voting results.
 * State transitions follow a strict progression through the proposal lifecycle.
 */
function proposalState(
    uint32 proposalId_
) public view virtual override returns (ProposalState) {
    // Implementation...
}
```

#### Example 3: Enum with State Machine Documentation

```solidity
/**
 * @notice Represents the current state of a proposal in its lifecycle
 * @dev State transitions are determined by timestamps and voting results from the strategy
 *
 * State Machine Flow:
 * - ACTIVE: Initial state when proposal is created. Voting is open.
 *   → FAILED: If strategy.isPassed() returns false when voting ends
 *   → TIMELOCKED: If strategy.isPassed() returns true when voting ends
 * - TIMELOCKED: Voting passed, waiting for timelock period
 *   → EXECUTABLE: When block.timestamp > votingEnd + timelockPeriod
 * - EXECUTABLE: Ready for execution
 *   → EXECUTED: When all transactions have been executed
 *   → EXPIRED: When block.timestamp > votingEnd + timelockPeriod + executionPeriod
 *
 * Terminal states: FAILED, EXECUTED, EXPIRED
 *
 * Values:
 * - ACTIVE: Proposal is in voting period
 * - TIMELOCKED: Voting passed, waiting for timelock period
 * - EXECUTABLE: Timelock expired, can be executed
 * - EXECUTED: All transactions successfully executed
 * - EXPIRED: Execution period passed without full execution
 * - FAILED: Voting did not pass according to strategy rules
 */
enum ProposalState {
    ACTIVE,
    TIMELOCKED,
    EXECUTABLE,
    EXECUTED,
    EXPIRED,
    FAILED
}
```

#### Example 4: Complex Function with Inline Comments

From `StrategyV1.sol`:

```solidity
function castVote(
    uint32 proposalId_,
    uint8 voteType_,
    VotingAdapterVoteData[] calldata votingAdaptersData,
    uint256 lightAccountIndex_
) public virtual override {
    // Step 1: Resolve the actual voter address (support for Light Accounts/ERC-4337)
    // If lightAccountIndex_ > 0, this resolves to the Light Account owner
    address resolvedVoter = potentialLightAccountResolvedOwner(
        msg.sender,
        lightAccountIndex_
    );

    // Step 2: Verify the proposal has been initialized
    if (proposal.votingEndTimestamp == 0) {
        revert ProposalNotInitialized();
    }

    // Step 3: Check if voting period has ended
    if (block.timestamp > proposal.votingEndTimestamp) {
        // Track the first late vote attempt for informational purposes
        // This helps with gasless voting infrastructure
        if (!$.voteCastedAfterVotingPeriodEnded[proposalId_]) {
            $.voteCastedAfterVotingPeriodEnded[proposalId_] = true;
            emit VotingPeriodEnded(proposalId_);
            return; // Exit gracefully on first late attempt
        }
        revert ProposalNotActive();
    }

    // Continue with voting logic...
}
```

### Additional Resources

- See `/tmp/natspec-documentation-plan.md` for comprehensive documentation tracking and additional examples
- Run `npm run docgen` after modifying contracts to update documentation
- Always cross-reference with test files to ensure documentation accuracy

## Git Commit Messages and Linear Tickets

When asked to create git commit messages or Linear tickets, follow these guidelines:

### Git Commit Messages & GitHub PRs

This project follows a one-commit-per-PR workflow. The first line of the commit message becomes the PR title, and the rest becomes the PR description.

**Format:**

- **Subject Line**: Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification
  - Format: `<type>(<scope>): <subject>`
  - Example: `feat(contracts): Implement new proxy factory`
- **Message Body**:
  - **Motivation**: High-level description of _what_ changed and _why_
  - **Change Summary**: Comprehensive, bulleted list of key changes

### Linear Tickets

**Format:**

- **Title**: Concise summary of the work
- **Description**: Always in **future tense** (as if work is about to start)
  - Clear goals and specific tasks as checklist items

### Output Location

When generating commit messages and Linear tickets:

1. Create files in `./tmp/commit-and-ticket-messages/`
2. Use descriptive filenames like `<feature-name>-<action>.md`
3. Include both git commit message and Linear ticket in the same file
4. Wrap each section in markdown code blocks for easy copying

Example: `./tmp/commit-and-ticket-messages/autonomous-admin-systemdeployer-refactor.md`
