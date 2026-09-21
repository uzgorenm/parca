import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const keySurfaces = [
  'src/app/_layout.tsx',
  'src/components/LoginOptions.tsx',
  'src/app/(tabs)/search.tsx',
  'src/app/(tabs)/index.tsx',
  'src/components/PropertyDetails.tsx',
  'src/components/TradeSheet.tsx',
];

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('every key journey surface renders the shared simulation disclosure', async () => {
  for (const path of keySurfaces) {
    const source = await read(path);
    assert.match(source, /<SimulationNotice\b/, `${path} must render SimulationNotice`);
  }
});
test('the shared disclosure states every hard product boundary', async () => {
  const source = await read('src/components/SimulationNotice.tsx');

  for (const requiredPhrase of [
    'Development simulation',
    'No real money can be deposited, withdrawn, or traded',
    'do not represent legal ownership',
    'not earned investment income',
  ]) {
    assert.ok(source.includes(requiredPhrase), `Missing disclosure phrase: ${requiredPhrase}`);
  }
});

test('key product surfaces avoid real-investment calls to action', async () => {
  const sources = await Promise.all(keySurfaces.map(read));
  const combined = sources.join('\n');

  for (const prohibited of [
    />\s*Deposit\s*</i,
    /Fractional Real Estate Trading/i,
    /Join the future of real estate investing/i,
    /Start trading fractional shares/i,
    /YOU OWN/i,
    /% Ownership/i,
    /Rental Yield/i,
    /Confirm Purchase/i,
    /Confirm Sale/i,
    /outpaced the local market/i,
  ]) {
    assert.doesNotMatch(combined, prohibited);
  }
});

test('the client has no payment-rail dependency', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  for (const packageName of Object.keys(dependencies)) {
    assert.doesNotMatch(packageName, /(stripe|plaid|braintree|adyen|paypal)/i);
  }
});
