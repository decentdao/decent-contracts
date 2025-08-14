# CLAUDE.md

## Contract Categories

The codebase is organized into four distinct categories based on deployment patterns:

1. **Deployables** (`contracts/deployables/`)

   - One instance per DAO
   - Hold state, long-lived, owned by DAOs
   - Examples: ModuleAzoriusV1, StrategyV1, VotingAdapters

2. **Singletons** (`contracts/singletons/`)

   - One instance per chain
   - Used by client applications, not referenced by DAO contracts
   - Examples: SystemDeployerV1, KeyValuePairsV1

3. **Utilities** (`contracts/utilities/`)

   - One instance per chain
   - Called via delegatecall from Safe during proposal execution
   - Stateless, handle dynamic logic based on blockchain state
   - Example: UtilityRolesManagementV1

4. **Services** (`contracts/services/`)
   - One instance per chain
   - Stateless, referenced by multiple DAO deployable contracts
   - Examples: StrategyV1ValidatorV1, VerifierV1

## Project Planning Workflow

When starting a new project or feature:

1. **I will prompt you** to describe the project that needs to be completed
2. **Provide context** including background, reasoning, and motivation for the work
3. **Share your approach** on how you think the work should happen
4. **We'll iterate together** to validate assumptions and refine the plan
5. **The plan will be continuously updated** throughout our discussion

**Initial Setup**

- Run `npm install` and `npm run compile` before starting work

Project plans are created in `./tmp/` and serve as both working documents and git commit messages.

See: [Project Planning Workflow Documentation](./docs/workflows/project-planning.md)

## Documentation Guidelines

### Solidity Development

#### NatSpec Documentation

Guidelines for documenting contracts:

- Contract documentation patterns
- Function documentation
- State variables and storage
- Common pitfalls to avoid

See: [NatSpec Documentation Guidelines](./docs/guidelines/natspec-documentation.md)

#### Coding Conventions

Standards for writing Solidity code:

- Contract architecture patterns
- Storage patterns (EIP-7201)
- Virtual/override rules
- Parameter and return conventions
- Inheritance patterns

See: [Solidity Coding Conventions](./docs/guidelines/solidity-conventions.md)

### Code Quality

Requirements for code formatting and linting:

- Prettier configuration
- ESLint for TypeScript
- Solhint for Solidity

See: [Code Quality Requirements](./docs/guidelines/code-quality.md)

## Important Instructions

1. **Always use the todo list** to track tasks throughout our conversations
2. **Run code quality checks** before committing:
   - `npm run pretty` - Format all code
   - `npm run lint` - Lint TypeScript files
   - `npm run solhint` - Lint Solidity contracts
   - `npm run test` - Run test suite
3. **Follow the project planning workflow** for all new features and refactors
4. **Never duplicate documentation** - use `@inheritdoc` for interface functions
5. **Maintain consistent formatting** across all documentation
