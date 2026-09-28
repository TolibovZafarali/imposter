import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import sharp from 'sharp';
import {
  canShareArtwork,
  createArtworkTools,
  createInventory,
  eligibilitySource,
  inspectAlpha,
  PILOT_IDS,
  PROMPT_VERSION,
  registrySource,
  serverSensesSource,
  selectQueue,
  summarizeManifest,
} from '../scripts/word-artwork.mjs';
import { ENGLISH_WORD_BANK } from '../data/wordBank.ts';

const makeEntry = (word) => ({ id: `objects-easy-${word}`, word, hint: 'shape', categoryId: 'objects', difficulty: 'easy' });
const catalog = [makeEntry('umbrella'), makeEntry('chair')];

async function setup(t, entries = catalog, pilotIds = [entries[0].id]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'word-artwork-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const serverOutputPath = path.join(root, 'server', 'illustration-senses.ts');
  const tools = createArtworkTools({ root, catalog: entries, pilotIds, serverOutputPath });
  await tools.init();
  await tools.build();
  const promptFile = path.join(root, 'prompts.json');
  await fs.writeFile(promptFile, JSON.stringify(Object.fromEntries(entries.map((entry) =>
    [entry.id, `One complete centered ${entry.word}, transparent background, crimson accents.`]))));
  return { root, tools, promptFile, serverOutputPath };
}

async function writeSubject(root, filename = 'subject.png', color = '#B6192E') {
  const output = path.join(root, filename);
  const subject = await sharp({ create: { width: 300, height: 320, channels: 4, background: color } }).png().toBuffer();
  await sharp({ create: { width: 640, height: 640, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: subject, left: 170, top: 160 }]).png().toFile(output);
  return output;
}

async function classifyAll(root, tools, entries = catalog, extra = {}) {
  const filename = path.join(root, 'eligibility.json');
  await fs.writeFile(filename, JSON.stringify({ schemaVersion: 1, entries: entries.map((entry) => ({
    id: entry.id, eligibility: 'eligible', depictedMeaning: entry.word, exclusionReason: null,
    ...(extra[entry.id] ?? {}),
  })) }));
  return tools.classify(filename);
}

async function applyAliases(root, tools, entries) {
  const filename = path.join(root, 'aliases.json');
  await fs.writeFile(filename, JSON.stringify({ schemaVersion: 1, entries }));
  return tools.aliases(filename);
}

test('inventory preserves all 2985 entries as unresolved until reviewed and never hides them as exclusions', () => {
  const manifest = createInventory(ENGLISH_WORD_BANK);
  const report = summarizeManifest(manifest);
  assert.equal(report.catalogEntries, 2985);
  assert.equal(report.eligibility.eligible, 24);
  assert.equal(report.eligibility.candidate, 2961);
  assert.equal(report.eligibility.excluded, 0);
  assert.equal(report.unresolved, 2985);
  assert.equal(report.releaseReady, false);
  assert.deepEqual(selectQueue(manifest).map((entry) => entry.id), PILOT_IDS);
  assert.throws(() => selectQueue(manifest, 25), /between 1 and 24/);
});

test('alpha inspection rejects opaque, blank, and edge-clipped artwork', () => {
  const pixels = Buffer.alloc(4 * 4 * 4);
  pixels[(1 * 4 + 1) * 4 + 3] = 255;
  assert.deepEqual(inspectAlpha(pixels, 4, 4, 4).errors, []);
  assert.match(inspectAlpha(Buffer.alloc(64, 255), 4, 4, 4).errors.join(' '), /transparent/);
  assert.match(inspectAlpha(Buffer.alloc(64), 4, 4, 4).errors.join(' '), /visible subject/);
  pixels[3] = 255;
  assert.match(inspectAlpha(pixels, 4, 4, 4).errors.join(' '), /border/);
});

test('import preserves original bytes and builds only reviewed 512px transparent artwork', async (t) => {
  const { root, tools, promptFile } = await setup(t);
  const filename = await writeSubject(root);
  const original = await fs.readFile(filename);
  const imported = await tools.import(catalog[0].id, filename, promptFile);
  assert.equal(imported.status, 'generated');
  assert.deepEqual(await fs.readFile(path.join(root, imported.original.path)), original);
  const optimized = await sharp(path.join(root, imported.processed.path)).metadata();
  assert.equal(optimized.width, 512);
  assert.equal(optimized.height, 512);
  assert.equal(optimized.hasAlpha, true);
  assert.equal((await tools.build()).uniqueAssets, 0);
  await assert.rejects(() => tools.review(catalog[0].id, 'approved', ''), /notes/);
  await tools.review(catalog[0].id, 'approved', 'Subject and transparent edges checked on white and dark backgrounds.');
  assert.equal((await tools.build()).uniqueAssets, 1);
  const registry = await fs.readFile(path.join(root, 'data/wordIllustrations.ts'), 'utf8');
  assert.match(registry, /'objects-easy-umbrella': require\('\.\.\/assets\/word-illustrations\/objects-easy-umbrella.webp'\)/);
  assert.equal((await tools.validate()).valid, true);
  assert.equal((await tools.import(catalog[0].id, filename)).status, 'approved');
  assert.deepEqual(await fs.readFile(path.join(root, imported.original.path)), original);
});

test('opaque backgrounds and files smaller than 512 are rejected before import', async (t) => {
  const { root, tools } = await setup(t);
  const opaque = path.join(root, 'opaque.png');
  await sharp({ create: { width: 640, height: 640, channels: 4, background: '#fff' } }).png().toFile(opaque);
  await assert.rejects(() => tools.import(catalog[0].id, opaque), /transparent|border/);
  const small = path.join(root, 'small.png');
  await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toFile(small);
  await assert.rejects(() => tools.import(catalog[0].id, small), /at least 512/);
});

test('nonpilot work stays gated until all artwork approvals and recorded QA checks', async (t) => {
  const { root, tools, promptFile } = await setup(t);
  await classifyAll(root, tools);
  const first = await writeSubject(root);
  const second = await writeSubject(root, 'second.png', '#222');
  await assert.rejects(() => tools.import(catalog[1].id, second), /pilot QA gate/);
  await tools.import(catalog[0].id, first, promptFile);
  assert.equal((await tools.queue()).count, 0);
  await assert.rejects(() => tools.pilotQa('Checked', ['visual', 'interaction', 'offline']), /not been approved/);
  await tools.review(catalog[0].id, 'approved', 'Reviewed subject and alpha.');
  await assert.rejects(() => tools.pilotQa('Checked', ['visual']), /interaction/);
  await assert.rejects(() => tools.pilotQa('Checked', ['visual', 'interaction', 'offline']), /Build and validate/);
  await tools.build();
  await tools.pilotQa('Visual, hold and release, pass, background, and offline checks passed.', ['visual', 'interaction', 'offline']);
  assert.deepEqual((await tools.queue()).ids, [catalog[1].id]);
  await tools.import(catalog[1].id, second, promptFile);
  await tools.review(catalog[1].id, 'approved', 'Reviewed subject and alpha.');
  await tools.build();
  assert.equal((await tools.report()).artworkReady, true);
  assert.equal((await tools.report()).releaseReady, false);
  await tools.review(catalog[0].id, 'rejected', 'Revise silhouette.');
  assert.equal((await tools.inventory()).pilot.qa.approved, false);
  assert.equal((await tools.report()).releaseReady, false);
});

test('legacy couch and sofa review gains provenance and reuses one file', async (t) => {
  const entries = [makeEntry('sofa'), makeEntry('couch'), makeEntry('chair')];
  const { root, tools, promptFile } = await setup(t, entries);
  await classifyAll(root, tools, entries, { [entries[1].id]: { sharedWith: entries[0].id } });
  const manifest = await tools.load();
  assert.equal(canShareArtwork(manifest.entries[1], manifest.entries[0]), true);
  assert.equal(canShareArtwork(manifest.entries[2], manifest.entries[0]), false);
  assert.match(manifest.entries[1].equivalenceReason, /Previously reviewed/);
  await tools.import(entries[0].id, await writeSubject(root), promptFile);
  await tools.review(entries[0].id, 'approved', 'Shared couch and sofa meaning verified.');
  assert.equal((await tools.build()).uniqueAssets, 1);
  const source = registrySource(await tools.load());
  assert.match(source, /'objects-easy-couch': require\('\.\.\/assets\/word-illustrations\/objects-easy-sofa.webp'\)/);
  assert.equal((await tools.validate()).valid, true);
  await assert.rejects(() => classifyAll(root, tools, entries, { [entries[2].id]: { sharedWith: entries[0].id } }), /equivalence/);
});

test('validation catches changed assets, stale registry, unsafe paths and incomplete inventory', async (t) => {
  const { root, tools, promptFile } = await setup(t);
  await tools.import(catalog[0].id, await writeSubject(root), promptFile);
  await tools.review(catalog[0].id, 'approved', 'Subject verified.');
  await tools.build();
  const manifest = await tools.load();
  await fs.writeFile(path.join(root, 'data/wordIllustrations.ts'), 'stale');
  const runtime = path.join(root, 'assets/word-illustrations', `${catalog[0].id}.webp`);
  await fs.writeFile(runtime, 'changed');
  manifest.entries[0].original.path = '../../outside.png';
  manifest.entries.pop();
  await fs.writeFile(path.join(root, 'output/word-artwork/manifest.json'), JSON.stringify(manifest));
  const report = await tools.validate();
  assert.equal(report.valid, false);
  assert.equal(report.releaseReady, false);
  assert.ok(report.errors.some((error) => error.includes('allowed directory')));
  assert.ok(report.errors.some((error) => error.includes('Runtime hash mismatch')));
  assert.ok(report.errors.some((error) => error.includes('registry is stale')));
  assert.ok(report.errors.some((error) => error.includes('Missing catalog ID')));
});

test('changed meanings require another review and contact sheets show white and dark backgrounds', async (t) => {
  const { root, tools, promptFile } = await setup(t);
  await tools.import(catalog[0].id, await writeSubject(root), promptFile);
  await tools.review(catalog[0].id, 'approved', 'Subject verified.');
  await classifyAll(root, tools, catalog, { [catalog[0].id]: { depictedMeaning: 'An open handheld rain umbrella' } });
  assert.equal((await tools.load()).entries[0].status, 'generated');
  const contactSheet = await tools.contactSheet();
  const html = await fs.readFile(contactSheet.path, 'utf8');
  assert.match(html, /class="white"/);
  assert.match(html, /class="dark"/);
  assert.match(html, /An open handheld rain umbrella/);
  assert.equal(contactSheet.pngPaths.length, 1);
  const preview = await sharp(contactSheet.pngPaths[0]).metadata();
  assert.equal(preview.width, 896);
  assert.equal(preview.height, 280);
});

test('exact prompts attach to existing originals without modifying image bytes or queue templates', async (t) => {
  const { root, tools, promptFile } = await setup(t);
  const filename = await writeSubject(root);
  const imported = await tools.import(catalog[0].id, filename);
  await assert.rejects(() => tools.review(catalog[0].id, 'approved', 'Checked.'), /Missing exact prompt provenance/);
  const exactPrompt = '  A crimson umbrella.\nNo backdrop; keep all edges clear.\n';
  await fs.writeFile(promptFile, JSON.stringify({ [catalog[0].id]: exactPrompt }));
  const originalBytes = await fs.readFile(path.join(root, imported.original.path));
  const processedBytes = await fs.readFile(path.join(root, imported.processed.path));
  const queuedPrompt = selectQueue(createInventory(catalog, [catalog[0].id]))[0].prompt;
  await tools.recordPrompt(catalog[0].id, promptFile);
  const entry = (await tools.load()).entries[0];
  assert.equal(entry.promptProvenance.text, exactPrompt);
  assert.equal(entry.promptProvenance.sha256, createHash('sha256').update(exactPrompt).digest('hex'));
  assert.equal(entry.promptProvenance.originalSha256, imported.original.sha256);
  assert.equal(entry.promptProvenance.promptVersion, PROMPT_VERSION);
  assert.deepEqual(await fs.readFile(path.join(root, imported.original.path)), originalBytes);
  assert.deepEqual(await fs.readFile(path.join(root, imported.processed.path)), processedBytes);
  await tools.review(catalog[0].id, 'approved', 'Checked subject and transparency.');
  await tools.build();
  assert.equal((await tools.validate()).valid, true);
  assert.equal(selectQueue(createInventory(catalog, [catalog[0].id]))[0].prompt, queuedPrompt);
  const replacement = await writeSubject(root, 'replacement.png', '#333');
  await tools.import(catalog[0].id, replacement);
  const changed = (await tools.load()).entries[0];
  assert.equal(changed.promptProvenance, null);
  assert.equal(changed.previousPromptProvenance[0].originalSha256, imported.original.sha256);
  assert.equal(changed.status, 'generated');
  await tools.review(catalog[0].id, 'approved', 'Replacement reviewed.', promptFile);
  assert.equal((await tools.load()).entries[0].promptProvenance.originalSha256, changed.original.sha256);
});

test('prompt hash or original mismatch blocks approval and the pilot gate', async (t) => {
  const { root, tools, promptFile } = await setup(t);
  await tools.import(catalog[0].id, await writeSubject(root), promptFile);
  await tools.review(catalog[0].id, 'approved', 'Subject and edges verified.');
  await tools.build();
  const manifest = await tools.load();
  manifest.entries[0].promptProvenance.text = 'Different prompt';
  await fs.writeFile(path.join(root, 'output/word-artwork/manifest.json'), JSON.stringify(manifest));
  assert.equal((await tools.validate()).valid, false);
  await assert.rejects(() => tools.pilotQa('Checked', ['visual', 'interaction', 'offline']), /Prompt hash mismatch/);
  await assert.rejects(() => tools.build(), /Prompt hash mismatch/);
  manifest.entries[0].promptProvenance.sha256 = createHash('sha256').update('Different prompt').digest('hex');
  manifest.entries[0].promptProvenance.originalSha256 = 'different-original';
  await fs.writeFile(path.join(root, 'output/word-artwork/manifest.json'), JSON.stringify(manifest));
  await assert.rejects(() => tools.review(catalog[0].id, 'approved', 'Checked'), /current original/);
});

test('server senses include every eligible depicted meaning and detect stale or missing output', async (t) => {
  const entries = [makeEntry('bat'), makeEntry('couch'), makeEntry('sofa')];
  const { root, tools, serverOutputPath } = await setup(t, entries);
  const depictedMeaning = 'A baseball bat with a rounded barrel; not a cricket bat or animal.';
  await classifyAll(root, tools, entries, {
    [entries[0].id]: { depictedMeaning },
    [entries[1].id]: { eligibility: 'excluded', exclusionReason: 'Excluded fixture subject.' },
  });
  const manifest = await tools.load();
  const source = await fs.readFile(serverOutputPath, 'utf8');
  assert.equal(source, serverSensesSource(manifest));
  assert.match(source, /A baseball bat with a rounded barrel/);
  assert.doesNotMatch(source, /objects-easy-couch/);
  const { getIllustrationSense } = await import(pathToFileURL(serverOutputPath).href);
  assert.equal(getIllustrationSense(entries[0].id), depictedMeaning);
  assert.equal(getIllustrationSense(entries[2].id), 'sofa');
  assert.equal(getIllustrationSense(entries[1].id), undefined);
  assert.equal(getIllustrationSense('toString'), undefined);
  assert.equal((await tools.validate()).valid, true);
  await fs.writeFile(serverOutputPath, 'stale');
  assert.ok((await tools.validate()).errors.includes('Server illustration senses are stale; run build'));
  await tools.build();
  assert.equal(await fs.readFile(serverOutputPath, 'utf8'), source);
  await fs.unlink(serverOutputPath);
  assert.ok((await tools.validate()).errors.includes('Server illustration senses are missing; run build'));
});

test('custom roots keep default server output inside their own directory', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'word-artwork-isolated-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const tools = createArtworkTools({ root, catalog, pilotIds: [catalog[0].id] });
  await tools.init();
  const result = await tools.build();
  assert.equal(result.serverSensesPath, path.join(root, 'output/word-artwork/illustration-senses.ts'));
  assert.equal((await tools.validate()).valid, true);
});

test('reviewed flashlight and torch synonyms share one approved asset and one depicted translation sense', async (t) => {
  const entries = [makeEntry('flashlight'), makeEntry('torch')];
  const { root, tools, promptFile, serverOutputPath } = await setup(t, entries);
  await classifyAll(root, tools, entries, {
    [entries[0].id]: { depictedMeaning: 'A handheld battery-powered electric flashlight.' },
    [entries[1].id]: { depictedMeaning: 'The handheld electric torch, not a burning stick.' },
  });
  await applyAliases(root, tools, [{
    id: entries[1].id, sharedWith: entries[0].id,
    equivalenceReason: 'Torch names the same handheld electric flashlight in this reviewed sense.',
  }]);
  await tools.import(entries[0].id, await writeSubject(root), promptFile);
  await tools.review(entries[0].id, 'approved', 'Battery-powered handheld light and edges verified.');
  assert.equal((await tools.build()).uniqueAssets, 1);
  const manifest = await tools.load();
  assert.equal(canShareArtwork(manifest.entries[1], manifest.entries[0]), true);
  assert.match(registrySource(manifest), /'objects-easy-torch': require\('\.\.\/assets\/word-illustrations\/objects-easy-flashlight.webp'\)/);
  const { getIllustrationSense } = await import(pathToFileURL(serverOutputPath).href);
  assert.equal(getIllustrationSense(entries[1].id), 'A handheld battery-powered electric flashlight.');
  assert.equal((await tools.validate()).valid, true);
  assert.equal((await tools.inventory()).status.approved, 2);
});

test('alias ingestion rejects missing review reasons, unknown IDs, self sharing, chains, cycles, excluded sources and pilot aliases', async (t) => {
  const entries = [makeEntry('umbrella'), makeEntry('torch'), makeEntry('flashlight'), makeEntry('lamp')];
  const { root, tools } = await setup(t, entries);
  await classifyAll(root, tools, entries);
  const reviewed = (id, sharedWith) => ({ id, sharedWith, equivalenceReason: 'Explicit equivalent depicted meaning reviewed.' });
  const cases = [
    [{ id: entries[1].id, sharedWith: entries[2].id }],
    [reviewed('objects-easy-missing', entries[2].id)],
    [reviewed(entries[1].id, 'objects-easy-missing')],
    [reviewed(entries[1].id, entries[1].id)],
    [reviewed(entries[1].id, entries[2].id), reviewed(entries[2].id, entries[3].id)],
    [reviewed(entries[1].id, entries[2].id), reviewed(entries[2].id, entries[1].id)],
    [reviewed(entries[0].id, entries[2].id)],
  ];
  const before = await tools.load();
  for (const review of cases) {
    await assert.rejects(() => applyAliases(root, tools, review), /equivalenceReason|Unknown|itself|chains|cycles|Pilot/);
    assert.deepEqual(await tools.load(), before);
  }
  await classifyAll(root, tools, entries, {
    [entries[3].id]: { eligibility: 'excluded', exclusionReason: 'Excluded fixture subject.' },
  });
  await assert.rejects(() => applyAliases(root, tools, [reviewed(entries[1].id, entries[3].id)]), /eligible and standalone/);
});

test('changed source or alias meanings require an explicit renewed equivalence review', async (t) => {
  const entries = [makeEntry('umbrella'), makeEntry('torch'), makeEntry('flashlight')];
  const { root, tools } = await setup(t, entries);
  await classifyAll(root, tools, entries);
  await applyAliases(root, tools, [{
    id: entries[1].id, sharedWith: entries[2].id, equivalenceReason: 'The two terms denote the same electric handheld light.',
  }]);
  await assert.rejects(() => classifyAll(root, tools, entries, {
    [entries[2].id]: { depictedMeaning: 'A compact battery-powered flashlight with a circular lens.' },
  }), /equivalence no longer matches/);
  await assert.rejects(() => classifyAll(root, tools, entries, {
    [entries[1].id]: { depictedMeaning: 'An electric handheld torch with a circular lens.' },
  }), /equivalence no longer matches/);
  await classifyAll(root, tools, entries, {
    [entries[1].id]: { depictedMeaning: 'An electric handheld torch with a circular lens.',
      sharedWith: entries[2].id, equivalenceReason: 'The refined descriptions still name the same electric light with a circular lens.' },
    [entries[2].id]: { depictedMeaning: 'A compact battery-powered flashlight with a circular lens.' },
  });
  const manifest = await tools.load();
  assert.equal(canShareArtwork(manifest.entries[1], manifest.entries[2]), true);
  const server = serverSensesSource(manifest);
  assert.equal(server.match(/A compact battery-powered flashlight with a circular lens\./g).length, 2);
});

test('client eligibility output contains only eligible IDs, imports no assets, and detects drift', async (t) => {
  const { root, tools } = await setup(t);
  await classifyAll(root, tools, catalog, {
    [catalog[1].id]: { eligibility: 'excluded', exclusionReason: 'Excluded fixture subject.' },
  });
  const filename = path.join(root, 'data/wordIllustrationIds.ts');
  const source = await fs.readFile(filename, 'utf8');
  assert.equal(source, eligibilitySource(await tools.load()));
  assert.doesNotMatch(source, /require\(|from |\.webp|\.png/);
  const { isWordIllustrationEligible } = await import(pathToFileURL(filename).href);
  assert.equal(isWordIllustrationEligible(catalog[0].id), true);
  assert.equal(isWordIllustrationEligible(catalog[1].id), false);
  assert.equal(isWordIllustrationEligible('objects-easy-missing'), false);
  assert.equal(isWordIllustrationEligible('toString'), false);
  await fs.writeFile(filename, 'stale');
  assert.ok((await tools.validate()).errors.includes('Client illustration eligibility is stale; run build'));
  await tools.build();
  assert.equal(await fs.readFile(filename, 'utf8'), source);
});

test('a completed library and pilot fixture remain separate from final production release proof', async (t) => {
  const { root, tools, promptFile } = await setup(t, [catalog[0]]);
  const evidencePath = 'output/release-evidence.txt';
  await fs.writeFile(path.join(root, evidencePath), 'Recorded release test results.');
  const proof = {
    productionBuild: { configuration: 'production', buildId: 'release-42', evidencePath, notes: 'Installed the identified production artifact.' },
    offline: { method: 'production-network-denial', evidencePath, notes: 'Networking denied in the production build; no host-network-off claim.' },
    voiceOver: { device: 'iPhone', evidencePath, notes: 'Spoken reveal and hide checked with VoiceOver.' },
    languageReview: { languages: ['spanish', 'japanese'], evidencePath, notes: 'Reviewed pictured meaning, text and fallback in both languages.' },
  };
  const proofFile = path.join(root, 'release-qa.json');
  await fs.writeFile(proofFile, JSON.stringify(proof));
  await assert.rejects(() => tools.releaseQa(proofFile), /Complete and validate/);
  await tools.import(catalog[0].id, await writeSubject(root), promptFile);
  await tools.review(catalog[0].id, 'approved', 'Subject and edges checked.');
  await tools.build();
  await tools.pilotQa('Pilot fixture checks with controlled network denial; production release proof pending.', ['visual', 'interaction', 'offline']);
  assert.equal((await tools.report()).artworkReady, true);
  assert.equal((await tools.report()).releaseReady, false);
  await fs.writeFile(proofFile, JSON.stringify({ ...proof, productionBuild: { ...proof.productionBuild, configuration: 'fixture' } }));
  await assert.rejects(() => tools.releaseQa(proofFile), /production build/);
  await fs.writeFile(proofFile, JSON.stringify({ ...proof, voiceOver: undefined }));
  await assert.rejects(() => tools.releaseQa(proofFile), /VoiceOver/);
  await fs.writeFile(proofFile, JSON.stringify({ ...proof, languageReview: { ...proof.languageReview, languages: ['english'] } }));
  await assert.rejects(() => tools.releaseQa(proofFile), /non-English/);
  await fs.writeFile(proofFile, JSON.stringify(proof));
  const result = await tools.releaseQa(proofFile);
  assert.equal(result.releaseReady, true);
  assert.equal(result.releaseQa.evidence.offline.method, 'production-network-denial');
  assert.equal((await tools.report()).releaseReady, true);
  await fs.writeFile(path.join(root, evidencePath), 'Corrected release evidence.');
  assert.equal((await tools.validate()).releaseReady, false);
  await tools.releaseQa(proofFile);
  assert.equal((await tools.validate()).releaseReady, true);
  const manifest = await tools.load();
  manifest.entries[0].sense = 'A changed depicted umbrella meaning';
  assert.equal(summarizeManifest(manifest).releaseReady, false);
  assert.equal(summarizeManifest(manifest).releaseQa.current, false);
});

test('new queue prompts use version2 without relabeling earlier approved prompt records', async (t) => {
  const { root, tools, promptFile } = await setup(t);
  const filename = await writeSubject(root);
  await tools.import(catalog[0].id, filename, promptFile, '1');
  await tools.review(catalog[0].id, 'approved', 'Version1 artwork remains approved.');
  const before = (await tools.load()).entries[0].promptProvenance;
  const manifest = await tools.load();
  const queued = selectQueue(createInventory(catalog, [catalog[0].id]));
  assert.equal(queued[0].promptVersion, '2');
  assert.match(queued[0].prompt, /matte 3D/);
  assert.match(queued[0].prompt, /small and unobtrusive/);
  assert.match(queued[0].prompt, /companion, animal, accessory/);
  assert.match(queued[0].prompt, /glow, cast shadow, or checkerboard/);
  await tools.queue();
  assert.equal(manifest.entries[0].promptVersion, '1');
  assert.deepEqual((await tools.load()).entries[0].promptProvenance, before);
  await tools.review(catalog[0].id, 'rejected', 'Regenerate without an extra companion.');
  const current = selectQueue(await tools.load())[0];
  await fs.writeFile(promptFile, JSON.stringify({ [catalog[0].id]: current.prompt }));
  await tools.import(catalog[0].id, await writeSubject(root, 'version2.png', '#333'), promptFile);
  assert.equal((await tools.load()).entries[0].promptProvenance.promptVersion, '2');
  assert.equal((await tools.load()).entries[0].previousPromptProvenance[0].promptVersion, '1');
});
