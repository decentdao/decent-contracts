#!/bin/bash

npm run clean
npm run compile
npm run test

npx hardhat export --export-all deployments.json

rm -rf publish && mkdir publish

# Step 1: Remove the `abi`, `name`, and `chainId` keys
jq 'walk(if type == "object" then del(.abi, .name, .chainId) else . end)' deployments.json > temp_addresses.json
# Step 2: Replace array with its single object item
jq 'to_entries | map({key: .key, value: .value[0]}) | from_entries' temp_addresses.json > temp_flat_addresses.json
# Step 3: Flatten the structure to remove bottom level objects
jq 'to_entries | map({key: .key, value: .value.contracts | map_values(.address)}) | from_entries' temp_flat_addresses.json > addresses.json
# Step 4: Wrap the JSON content in TypeScript format and append "as const;"
echo "export default $(cat addresses.json) as const;" > publish/addresses.ts
# Step 5: Cleanup
rm temp_addresses.json temp_flat_addresses.json addresses.json


# Step 1: Extract `abi` values directly under each contract key
jq '."1"[0].contracts | to_entries | map({key: .key, value: .value.abi}) | from_entries' deployments.json > abis.json
# Step 2: Wrap the JSON content in TypeScript format and append "as const;"
echo "export default $(cat abis.json) as const;" > publish/abis.ts
# Step 3: Cleanup
rm abis.json

rm deployments.json 

cat << EOF > publish/index.ts
import abis from "./publish/abis";
import addresses from "./publish/addresses";
export { abis, addresses };
EOF

# Run TypeScript compilation
tsc ./publish/index.ts
