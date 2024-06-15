#!/bin/bash

npm run clean
npm run compile
npm run test

npx hardhat export --export-all deployments.json

jq 'walk(if type == "object" then del(.abi, .name, .chainId) else . end)' deployments.json > temp_addresses.json
jq 'to_entries | map({key: .key, value: .value[0]}) | from_entries' temp_addresses.json > addresses.json
echo "export default $(cat addresses.json) as const;" > addresses.ts
rm temp_addresses.json addresses.json

jq '."1"[0].contracts' deployments.json > temp_abis.json
jq 'to_entries | map({key: .key, value: {abi: .value.abi}}) | from_entries' temp_abis.json > abis.json
echo "export default $(cat abis.json) as const;" > abis.ts
rm temp_abis.json abis.json

rm deployments.json 
