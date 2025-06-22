#!/bin/bash

# Exit on error
set -e

echo "Starting prepublish process..."

# Clean and compile
echo "Cleaning build artifacts..."
npm run clean

echo "Compiling contracts..."
npm run compile

echo "Running tests..."
npm run test

# Remove old publish directory
echo "Removing old publish directory..."
rm -rf publish && mkdir publish

# Process deployment artifacts
echo "Processing deployment artifacts..."
npx ts-node scripts/process-deployments.ts

# Compile TypeScript outputs
echo "Compiling TypeScript files..."
npx tsc ./publish/index.ts --declaration --outDir ./publish --target es2020 --module commonjs

echo "Prepublish complete!"
