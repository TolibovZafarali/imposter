import assert from 'node:assert/strict';
import test from 'node:test';

import { getLanguageFlagEmoji, LANGUAGES } from '../constants/languages.ts';

test('all languages have a valid flag country code', () => {
  assert.ok(LANGUAGES.length > 0);

  for (const language of LANGUAGES) {
    assert.match(
      language.flagCountryCode,
      /^[A-Z]{2}$/,
      `${language.id} should have a two-letter ISO country code`
    );

    const flagEmoji = getLanguageFlagEmoji(language);

    assert.ok(flagEmoji.length > 0, `${language.id} should produce a flag emoji`);
    assert.equal(
      Array.from(flagEmoji).length,
      2,
      `${language.id} should produce two regional indicator symbols`
    );
  }
});
