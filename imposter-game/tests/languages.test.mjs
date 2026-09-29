import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

import { LANGUAGES } from '../constants/languages.ts';

test('all languages have a valid country code and a bundled flag', () => {
  assert.ok(LANGUAGES.length > 0);
  const assetModuleUrl = new URL('../constants/flag-assets.ts', import.meta.url);
  const assetModule = readFileSync(assetModuleUrl, 'utf8');
  const require = createRequire(assetModuleUrl);
  const flagAssets = Object.fromEntries(
    [...assetModule.matchAll(/([A-Z]{2}): require\('([^']+)'\)/g)]
      .map(([, code, path]) => [code, require.resolve(path)])
  );

  for (const language of LANGUAGES) {
    assert.match(
      language.flagCountryCode,
      /^[A-Z]{2}$/,
      `${language.id} should have a two-letter ISO country code`
    );

    const assetPath = flagAssets[language.flagCountryCode];
    assert.ok(assetPath, `${language.id} should have a bundled flag`);
    const image = readFileSync(assetPath);
    assert.deepEqual(image.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(image.readUInt32BE(16), 128, `${language.id} should have a 128px-wide flag`);
    assert.equal(image.readUInt32BE(20), 96, `${language.id} should have a 96px-tall flag`);
  }
});
