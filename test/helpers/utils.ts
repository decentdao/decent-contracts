import type { FunctionFragment, Interface } from 'ethers';

/**
 * Calculate an interface ID from an ethers Interface object.
 * The interface ID is the XOR of all function selectors in the interface.
 * @param interfaceObj An ethers Interface object
 * @returns The interface ID as a hex string with 0x prefix
 */
export function calculateInterfaceId(interfaceObj: Interface): string {
  // Get all function fragments from the interface
  const fragments = interfaceObj.fragments.filter(
    (fragment): fragment is FunctionFragment => fragment.type === 'function',
  );

  if (fragments.length === 0) {
    throw new Error('Interface has no functions');
  }

  // XOR all function selectors
  let interfaceId = BigInt(0);
  for (const fragment of fragments) {
    // Get the selector by using the function's signature
    const selector = interfaceObj.getFunction(fragment.selector)?.selector;
    if (selector) {
      interfaceId = interfaceId ^ BigInt(selector);
    }
  }

  return '0x' + interfaceId.toString(16).padStart(8, '0');
}
