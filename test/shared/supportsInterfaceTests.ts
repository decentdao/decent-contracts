import { expect } from 'chai';
import type { FunctionFragment, Interface } from 'ethers';

/**
 * Calculate an interface ID from an ethers Interface object.
 * Optionally, an array of inherited interfaces can be provided to exclude their functions
 * from the ID calculation of the main interfaceObj.
 * The interface ID is the XOR of all (potentially filtered) function selectors in the interface.
 * @param interfaceObj An ethers Interface object for which to calculate the ID.
 * @param inheritedInterfacesArray Optional array of ethers Interface objects representing base/inherited interfaces.
 * @returns The interface ID as a hex string with 0x prefix
 */
function calculateInterfaceId(
  interfaceObj: Interface,
  inheritedInterfacesArray?: Interface[],
): string {
  let inheritedSelectors = new Set<string>();

  if (inheritedInterfacesArray && inheritedInterfacesArray.length > 0) {
    for (const inheritedInterface of inheritedInterfacesArray) {
      const inheritedFragments = inheritedInterface.fragments.filter(
        (fragment): fragment is FunctionFragment => fragment.type === 'function',
      );
      for (const fragment of inheritedFragments) {
        inheritedSelectors.add(fragment.selector);
      }
    }
  }

  // Get all function fragments from the main interface
  const primaryFragments = interfaceObj.fragments.filter(
    (fragment): fragment is FunctionFragment => fragment.type === 'function',
  );

  // Filter out functions that are present in the inherited interfaces
  const uniqueFragments = primaryFragments.filter(
    fragment => !inheritedSelectors.has(fragment.selector),
  );

  if (uniqueFragments.length === 0) {
    // This can happen if interfaceObj truly has no unique functions, or all its functions were inherited.
    // Depending on desired behavior, you might want to return '0x00000000' or throw a specific error.
    // For now, let's indicate that no unique functions were found for ID calculation.
    // If the original interface (interfaceObj) also had no functions at all before filtering,
    // it might be better to throw an error earlier.
    if (primaryFragments.length === 0) {
      throw new Error('Main interface has no functions to begin with.');
    }
    // If it had functions, but all were filtered out, it means all functions were inherited.
    // In this case, the ID of its unique part is effectively zero in terms of XORing selectors.
    return '0x00000000';
  }

  // XOR all unique function selectors
  let interfaceId = BigInt(0);
  for (const fragment of uniqueFragments) {
    interfaceId = interfaceId ^ BigInt(fragment.selector);
  }

  return '0x' + interfaceId.toString(16).padStart(8, '0');
}

/**
 * Interface factory type that has a createInterface method
 */
interface InterfaceFactory {
  createInterface(): Interface;
  name: string;
}

/**
 * Contract that implements supportsInterface method
 */
interface SupportsInterfaceContract {
  supportsInterface(interfaceId: string): Promise<boolean>;
}

/**
 * Configuration for an interface with inherited interfaces
 */
interface InterfaceConfig {
  factory: InterfaceFactory;
  inheritedFactories?: InterfaceFactory[];
}

/**
 * Parameters for running the supportsInterface tests
 */
interface SupportsInterfaceTestParams {
  /**
   * Gets the contract instance that implements supportsInterface
   */
  getContract: () => SupportsInterfaceContract;

  /**
   * Array of interface factories or configurations that the contract should support
   */
  supportedInterfaceFactories: (InterfaceFactory | InterfaceConfig)[];
}

/**
 * Run supportsInterface tests for a contract
 * @param params The test parameters
 */
export function runSupportsInterfaceTests(params: SupportsInterfaceTestParams): void {
  params.supportedInterfaceFactories.forEach(item => {
    // Check if this is a simple factory or a config object
    const isConfig = 'factory' in item;
    const factory = isConfig ? (item as InterfaceConfig).factory : (item as InterfaceFactory);
    const inheritedFactories = isConfig ? (item as InterfaceConfig).inheritedFactories : undefined;

    // Extract the interface name from the factory
    // Since factories are ES6 classes, factory.name should give us the class name
    const factoryName = factory.name;

    // Remove the __factory suffix to get the interface name
    const interfaceName = factoryName.slice(0, -9);

    it(`should support ${interfaceName}`, async () => {
      const contract = params.getContract();

      // Calculate interface ID, excluding inherited interfaces if specified
      const interfaceId = inheritedFactories
        ? calculateInterfaceId(
            factory.createInterface(),
            inheritedFactories.map(f => f.createInterface()),
          )
        : calculateInterfaceId(factory.createInterface());

      expect(await contract.supportsInterface(interfaceId)).to.be.true;
    });
  });

  it('should not support a random interface', async () => {
    const contract = params.getContract();
    const randomInterfaceId = '0x12345678';

    expect(await contract.supportsInterface(randomInterfaceId)).to.be.false;
  });
}
