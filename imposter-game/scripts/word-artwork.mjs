import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { ENGLISH_WORD_BANK } from '../data/wordBank.ts';

export const PILOT_IDS = [
  'objects-easy-umbrella', 'objects-easy-keys', 'objects-easy-scissors', 'objects-easy-camera',
  'animals-easy-elephant', 'animals-easy-penguin', 'animals-easy-butterfly', 'animals-easy-jellyfish',
  'food-easy-pizza', 'food-easy-apple', 'food-medium-croissant', 'food-easy-sushi',
  'activities-easy-hiking', 'activities-easy-reading', 'activities-easy-jogging', 'activities-easy-knitting',
  'places-easy-island', 'places-medium-lighthouse', 'places-easy-waterfall', 'places-easy-airport',
  'sports-easy-soccer', 'sports-easy-basketball', 'sports-easy-tennis', 'sports-easy-skiing',
];
export const PROMPT_VERSION = '2';
export const TARGET_AVERAGE_BYTES = 40 * 1024;
export const MAX_ASSET_BYTES = 100 * 1024;
const ELIGIBILITIES = ['candidate', 'eligible', 'excluded'];
const STATUSES = ['pending', 'generated', 'approved', 'rejected'];
const PIPELINE_ROOT = 'output/word-artwork';
const RUNTIME_ROOT = 'assets/word-illustrations';
const REGISTRY_PATH = 'data/wordIllustrations.ts';
const ELIGIBILITY_PATH = 'data/wordIllustrationIds.ts';
const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const assert = (condition, message) => { if (!condition) throw new Error(message); };

export function createInventory(catalog, pilotIds = PILOT_IDS) {
  const ids = new Set(catalog.map((entry) => entry.id));
  assert(ids.size === catalog.length, 'Catalog contains duplicate IDs');
  assert(pilotIds.every((id) => ids.has(id)), 'Pilot contains an unknown catalog ID');
  return {
    schemaVersion: 1,
    promptVersion: PROMPT_VERSION,
    accentColor: '#B6192E',
    pilot: { entryIds: [...pilotIds], qa: { approved: false } },
    releaseQa: { approved: false },
    entries: catalog.map((entry) => ({
      id: entry.id,
      word: entry.word,
      categoryId: entry.categoryId,
      difficulty: entry.difficulty,
      sense: entry.sense ?? entry.word,
      eligibility: pilotIds.includes(entry.id) ? 'eligible' : 'candidate',
      reason: pilotIds.includes(entry.id) ? 'Representative pilot subject' : 'Awaiting semantic review',
      status: 'pending',
      promptVersion: PROMPT_VERSION,
      promptProvenance: null,
      original: null,
      processed: null,
      review: null,
    })),
  };
}

export function inspectAlpha(data, width, height, channels) {
  assert(channels === 4, 'RGBA pixels are required');
  assert(data.length === width * height * channels, 'Pixel dimensions do not match the buffer');
  let transparent = 0;
  let visible = 0;
  let opaqueBorder = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * channels + 3];
      if (alpha <= 8) transparent += 1;
      if (alpha >= 32) visible += 1;
      if ((x === 0 || y === 0 || x === width - 1 || y === height - 1) && alpha > 8) opaqueBorder += 1;
    }
  }
  const transparentFraction = transparent / (width * height);
  const visibleFraction = visible / (width * height);
  const errors = [];
  if (transparentFraction < 0.05) errors.push('Less than 5% of pixels are transparent');
  if (visibleFraction < 0.01) errors.push('Image has no sufficiently visible subject');
  if (opaqueBorder > 0) errors.push('Visible pixels touch the image border');
  return { transparentFraction, visibleFraction, opaqueBorder, errors };
}

export function canShareArtwork(entry, source, pilotIds = []) {
  return Boolean(source && entry.id !== source.id && entry.eligibility === 'eligible' &&
    source.eligibility === 'eligible' && !source.sharedWith && !pilotIds.includes(entry.id) &&
    typeof entry.equivalenceReason === 'string' && entry.equivalenceReason.trim() &&
    entry.equivalenceEntrySenseHash === sha256(entry.sense) &&
    entry.equivalenceSourceSenseHash === sha256(source.sense));
}

const effectiveEntry = (manifest, entry) => entry.sharedWith
  ? manifest.entries.find((candidate) => candidate.id === entry.sharedWith)
  : entry;

export function artworkPrompt(entry) {
  return [
    `Create one isolated illustration of ${entry.sense}.`,
    `Exact game word: ${entry.word}. Category: ${entry.categoryId}.`,
    'Use soft dimensional matte 3D illustration, simplified calm editorial forms, natural proportions, a clear silhouette, and restrained detail.',
    'For people and animals, keep facial features small and unobtrusive. Avoid oversized eyes, exaggerated expressions, and toy-like proportions.',
    'Transparent background with real alpha. One complete centered subject, generous clear margin on all edges.',
    'No text, letters, numbers, logos, labels, frames, floor, backdrop, watermark, decorative scenery, glow, cast shadow, or checkerboard pattern.',
    'Use crimson #B6192E for naturally colorable details; preserve recognizable natural food and animal colors.',
    'Use only the minimum contextual elements needed to distinguish an activity, place, or sport.',
    'Do not add a companion, animal, accessory, or extra object unless it is essential to the exact subject described above.',
    'Keep incidental colors and props from introducing extra clues. Keep the subject legible at 120 pixels.',
    'Output a square image at least 512 by 512 pixels.',
  ].join(' ');
}

export function selectQueue(manifest, limit = 24) {
  assert(Number.isInteger(limit) && limit > 0 && limit <= 24, 'Queue limit must be between 1 and 24');
  const allowed = manifest.pilot.qa.approved
    ? manifest.entries
    : manifest.pilot.entryIds.map((id) => manifest.entries.find((entry) => entry.id === id));
  return allowed.filter((entry) => entry && entry.eligibility === 'eligible' && !entry.sharedWith &&
    ['pending', 'rejected'].includes(entry.status)).slice(0, limit).map((entry) => ({
      id: entry.id, word: entry.word, sense: entry.sense,
      promptVersion: PROMPT_VERSION, transparentBackground: true, prompt: artworkPrompt(entry),
    }));
}

export function registrySource(manifest) {
  const approved = manifest.entries.filter((entry) => entry.eligibility === 'eligible' &&
    effectiveEntry(manifest, entry)?.status === 'approved');
  const lines = approved.sort((a, b) => a.id.localeCompare(b.id)).map((entry) => {
    const source = effectiveEntry(manifest, entry);
    return `  '${entry.id}': require('../${RUNTIME_ROOT}/${source.id}.webp'),`;
  });
  return [
    'const wordIllustrations: Readonly<Record<string, number>> = Object.freeze({',
    ...lines,
    '});',
    '',
    'export const resolveWordIllustration = (entryId?: string | null): number | undefined =>',
    '  entryId && Object.hasOwn(wordIllustrations, entryId) ? wordIllustrations[entryId] : undefined;',
    '',
  ].join('\n');
}

export function serverSensesSource(manifest) {
  const lines = manifest.entries.filter((entry) => entry.eligibility === 'eligible')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((entry) => {
      const key = JSON.stringify(entry.id);
      const value = JSON.stringify(effectiveEntry(manifest, entry)?.sense);
      const line = `  ${key}: ${value},`;
      return line.length <= 80 ? line : `  ${key}:\n    ${value},`;
    });
  return [
    'const illustrationSenses: Readonly<Record<string, string>> = Object.freeze({',
    ...lines,
    '});',
    '',
    'export const getIllustrationSense = (entryId: string): string | undefined =>',
    '  Object.hasOwn(illustrationSenses, entryId)',
    '    ? illustrationSenses[entryId]',
    '    : undefined;',
    '',
  ].join('\n');
}

export function eligibilitySource(manifest) {
  const lines = manifest.entries.filter((entry) => entry.eligibility === 'eligible')
    .map((entry) => entry.id).sort().map((id) => `  '${id}',`);
  return [
    'const eligibleWordIllustrationIds: ReadonlySet<string> = new Set([',
    ...lines,
    ']);',
    '',
    'export const isWordIllustrationEligible = (entryId: string): boolean =>',
    '  eligibleWordIllustrationIds.has(entryId);',
    '',
  ].join('\n');
}

export function releaseArtworkFingerprint(manifest) {
  return sha256(JSON.stringify({
    entries: [...manifest.entries].sort((a, b) => a.id.localeCompare(b.id)).map((entry) => ({
      id: entry.id, eligibility: entry.eligibility, sense: entry.sense,
      sharedWith: entry.sharedWith ?? null,
      equivalenceReason: entry.equivalenceReason ?? null,
      status: effectiveEntry(manifest, entry)?.status,
      processedSha256: effectiveEntry(manifest, entry)?.processed?.sha256 ?? null,
    })),
    pilotQa: manifest.pilot.qa,
  }));
}

const nonemptyText = (value) => typeof value === 'string' && value.trim().length > 0;
const nonEnglishLanguage = (value) => !/^(?:en(?:[-_].*)?|english)$/i.test(value.trim());
export function hasCompleteReleaseEvidence(evidence) {
  return Boolean(evidence?.productionBuild?.configuration === 'production' &&
    nonemptyText(evidence.productionBuild.buildId) &&
    ['device-network-disabled', 'production-network-denial'].includes(evidence.offline?.method) &&
    nonemptyText(evidence.voiceOver?.device) &&
    Array.isArray(evidence.languageReview?.languages) && evidence.languageReview.languages.length > 0 &&
    evidence.languageReview.languages.every(nonemptyText) &&
    evidence.languageReview.languages.some(nonEnglishLanguage) &&
    ['productionBuild', 'offline', 'voiceOver', 'languageReview'].every((name) =>
      nonemptyText(evidence[name]?.notes) && nonemptyText(evidence[name]?.evidencePath)));
}

export function summarizeManifest(manifest) {
  const eligibility = Object.fromEntries(ELIGIBILITIES.map((value) => [value, 0]));
  const status = Object.fromEntries(STATUSES.map((value) => [value, 0]));
  const categories = {};
  const approvedSources = new Map();
  let unresolved = 0;
  for (const entry of manifest.entries) {
    eligibility[entry.eligibility] += 1;
    const source = effectiveEntry(manifest, entry);
    const effectiveStatus = source?.status ?? entry.status;
    status[effectiveStatus] += 1;
    categories[entry.categoryId] ??= { total: 0, approved: 0, excluded: 0, unresolved: 0 };
    categories[entry.categoryId].total += 1;
    if (entry.eligibility === 'excluded') categories[entry.categoryId].excluded += 1;
    else if (entry.eligibility === 'eligible' && effectiveStatus === 'approved') {
      categories[entry.categoryId].approved += 1;
      if (source.processed) approvedSources.set(source.id, source.processed);
    } else {
      unresolved += 1;
      categories[entry.categoryId].unresolved += 1;
    }
  }
  const assets = [...approvedSources.values()];
  const totalBytes = assets.reduce((sum, asset) => sum + asset.bytes, 0);
  const averageBytes = assets.length ? Math.round(totalBytes / assets.length) : 0;
  const oversized = [...approvedSources].filter(([, asset]) => asset.bytes > MAX_ASSET_BYTES).map(([id]) => id);
  const pilotApproved = manifest.pilot.entryIds.filter((id) => {
    const entry = manifest.entries.find((candidate) => candidate.id === id);
    return entry?.eligibility === 'eligible' && effectiveEntry(manifest, entry)?.status === 'approved';
  }).length;
  const artworkReady = unresolved === 0 && manifest.pilot.qa.approved && oversized.length === 0 &&
    averageBytes <= TARGET_AVERAGE_BYTES;
  const releaseQa = { ...(manifest.releaseQa ?? { approved: false }),
    current: manifest.releaseQa?.approved === true &&
      hasCompleteReleaseEvidence(manifest.releaseQa.evidence) &&
      manifest.releaseQa.artworkFingerprint === releaseArtworkFingerprint(manifest) };
  return {
    catalogEntries: manifest.entries.length, eligibility, status, categories, unresolved,
    pilot: { approvedArtwork: pilotApproved, requiredArtwork: manifest.pilot.entryIds.length, qa: manifest.pilot.qa },
    bundle: { uniqueAssets: assets.length, totalBytes, averageBytes, targetAverageBytes: TARGET_AVERAGE_BYTES,
      maxAssetBytes: MAX_ASSET_BYTES, oversized },
    artworkReady, releaseQa, releaseReady: artworkReady && releaseQa.current,
  };
}

export function createArtworkTools({ root = defaultRoot, catalog = ENGLISH_WORD_BANK, pilotIds = PILOT_IDS, serverOutputPath } = {}) {
  const manifestPath = path.join(root, PIPELINE_ROOT, 'manifest.json');
  const serverSensesPath = serverOutputPath ?? (path.resolve(root) === defaultRoot
    ? path.resolve(defaultRoot, '../supabase/functions/generate-round/catalog/illustration-senses.ts')
    : path.join(root, PIPELINE_ROOT, 'illustration-senses.ts'));
  const emitServerSenses = async (manifest) => {
    await fs.mkdir(path.dirname(serverSensesPath), { recursive: true });
    await fs.writeFile(serverSensesPath, serverSensesSource(manifest));
  };
  const emitEligibility = async (manifest) => {
    await fs.mkdir(path.join(root, 'data'), { recursive: true });
    await fs.writeFile(path.join(root, ELIGIBILITY_PATH), eligibilitySource(manifest));
  };
  const absolute = (relative, prefix = PIPELINE_ROOT) => {
    assert(typeof relative === 'string' && !path.isAbsolute(relative), 'Expected a relative artwork path');
    const result = path.resolve(root, relative);
    const allowed = path.resolve(root, prefix) + path.sep;
    assert(result.startsWith(allowed), 'Artwork path leaves its allowed directory');
    return result;
  };
  const load = async () => {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    assert(manifest.schemaVersion === 1 && Array.isArray(manifest.entries), 'Unsupported manifest schema');
    return manifest;
  };
  const save = async (manifest) => {
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    const temporary = `${manifestPath}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(manifest, null, 2) + '\n');
    await fs.rename(temporary, manifestPath);
  };
  const entryById = (manifest, id) => {
    const entry = manifest.entries.find((candidate) => candidate.id === id);
    assert(entry, `Unknown catalog ID: ${id}`);
    return entry;
  };
  const invalidatePilot = (manifest, id) => {
    if (manifest.pilot.entryIds.includes(id)) manifest.pilot.qa = { approved: false };
  };
  const clearSharing = (entry) => {
    for (const key of ['sharedWith', 'equivalenceReason', 'equivalenceEntrySenseHash',
      'equivalenceSourceSenseHash', 'equivalenceReviewedAt']) delete entry[key];
  };
  const recordSharing = (manifest, entry, sourceId, reason) => {
    assert(typeof reason === 'string' && reason.trim(), `An equivalenceReason is required for ${entry.id}`);
    const source = entryById(manifest, sourceId);
    assert(entry.id !== source.id, `Artwork cannot share with itself: ${entry.id}`);
    assert(!pilotIds.includes(entry.id), `Pilot subjects must retain independent artwork: ${entry.id}`);
    entry.sharedWith = source.id;
    entry.equivalenceReason = reason.trim();
    entry.equivalenceEntrySenseHash = sha256(entry.sense);
    entry.equivalenceSourceSenseHash = sha256(source.sense);
    entry.equivalenceReviewedAt = now();
  };
  const upgradeLegacySharing = (manifest) => {
    for (const entry of manifest.entries.filter((item) => item.sharedWith && !item.equivalenceReason)) {
      const source = entryById(manifest, entry.sharedWith);
      const words = new Set([entry.word.toLowerCase(), source.word.toLowerCase()]);
      if (words.size === 2 && words.has('couch') && words.has('sofa')) {
        recordSharing(manifest, entry, source.id,
          'Previously reviewed couch and sofa equivalence: both name the same upholstered seating subject.');
      }
    }
  };
  const validateSharing = (manifest) => {
    for (const entry of manifest.entries.filter((item) => item.sharedWith)) {
      const source = entryById(manifest, entry.sharedWith);
      assert(source.eligibility === 'eligible' && !source.sharedWith,
        `Sharing source must be eligible and standalone; chains and cycles are not allowed: ${entry.id}`);
      assert(canShareArtwork(entry, source, pilotIds),
        `Reviewed equivalence no longer matches depicted meanings or is incomplete: ${entry.id}`);
    }
  };
  const inspectFile = async (filename, expectedSize) => {
    const source = await fs.readFile(filename);
    const metadata = await sharp(source).metadata();
    assert(metadata.hasAlpha, 'Image does not contain a real alpha channel');
    assert((metadata.pages ?? 1) === 1, 'Animated images are not supported');
    assert(metadata.width >= 512 && metadata.height >= 512, 'Image must be at least 512 by 512 pixels');
    assert(metadata.width <= 8192 && metadata.height <= 8192, 'Image dimensions exceed 8192 pixels');
    if (expectedSize) assert(metadata.width === expectedSize && metadata.height === expectedSize, `Image must be ${expectedSize} square`);
    const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alpha = inspectAlpha(data, info.width, info.height, info.channels);
    assert(alpha.errors.length === 0, alpha.errors.join('; '));
    return { source, metadata, alpha, sha256: sha256(source) };
  };
  const checkArtifacts = async (entry) => {
    assert(entry.original && entry.processed, `Missing artifacts for ${entry.id}`);
    for (const [key, size] of [['original', undefined], ['processed', 512]]) {
      const artifact = entry[key];
      const checked = await inspectFile(absolute(artifact.path), size);
      assert(checked.sha256 === artifact.sha256, `Hash mismatch for ${entry.id} ${key}`);
      assert(checked.metadata.width === artifact.width && checked.metadata.height === artifact.height,
        `Dimension metadata mismatch for ${entry.id} ${key}`);
      if (key === 'processed') assert(checked.source.length === artifact.bytes, `Byte count mismatch for ${entry.id}`);
    }
  };
  const checkPrompt = (entry) => {
    const record = entry.promptProvenance;
    assert(record && typeof record.text === 'string' && record.text.trim(), `Missing exact prompt provenance for ${entry.id}`);
    assert(record.sha256 === sha256(record.text), `Prompt hash mismatch for ${entry.id}`);
    assert(record.originalSha256 === entry.original?.sha256, `Prompt does not describe the current original for ${entry.id}`);
    assert(record.promptVersion === entry.promptVersion, `Prompt version mismatch for ${entry.id}`);
  };
  const attachPrompt = async (entry, filename, explicitVersion) => {
    assert(entry.original, `Import an original before recording its prompt: ${entry.id}`);
    assert(typeof filename === 'string' && filename, 'An exact prompt file is required');
    const source = await fs.readFile(path.resolve(filename));
    let text = source.toString('utf8');
    let suppliedVersion;
    if (path.extname(filename).toLowerCase() === '.json') {
      const parsed = JSON.parse(text);
      const item = typeof parsed === 'string' ? parsed :
        Array.isArray(parsed) ? parsed.find((candidate) => candidate.id === entry.id) :
          parsed.entries?.find?.((candidate) => candidate.id === entry.id) ?? parsed[entry.id];
      text = typeof item === 'string' ? item : item?.prompt;
      suppliedVersion = typeof item === 'object' ? item?.promptVersion : undefined;
    }
    assert(typeof text === 'string' && text.trim(), `Prompt file has no exact prompt for ${entry.id}`);
    const promptVersion = String(explicitVersion ?? suppliedVersion ??
      (text === artworkPrompt(entry) ? PROMPT_VERSION : entry.promptVersion));
    assert(/^\d+$/.test(promptVersion), 'Prompt version must be a positive integer');
    assert(Number(promptVersion) > 0, 'Prompt version must be a positive integer');
    entry.promptVersion = promptVersion;
    const promptHash = sha256(text);
    if (entry.promptProvenance?.sha256 === promptHash && entry.promptProvenance.text === text &&
      entry.promptProvenance.originalSha256 === entry.original.sha256 &&
      entry.promptProvenance.promptVersion === entry.promptVersion) return;
    if (entry.promptProvenance) {
      entry.previousPromptProvenance ??= [];
      entry.previousPromptProvenance.push(entry.promptProvenance);
    }
    entry.promptProvenance = {
      text, sha256: promptHash, promptVersion: entry.promptVersion,
      originalSha256: entry.original.sha256, sourcePath: path.relative(root, path.resolve(filename)),
      sourceSha256: sha256(source), recordedAt: now(),
    };
  };
  return {
    load,
    async init() {
      try { return { initialized: false, ...summarizeManifest(await load()) }; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const manifest = createInventory(catalog, pilotIds);
      await save(manifest);
      return { initialized: true, ...summarizeManifest(manifest) };
    },
    async inventory() { return summarizeManifest(await load()); },
    async queue(limit = 24) {
      const manifest = await load();
      const queue = selectQueue(manifest, limit);
      const queuePath = path.join(root, PIPELINE_ROOT, 'queue.json');
      await fs.writeFile(queuePath, JSON.stringify({ promptVersion: PROMPT_VERSION, pilotGatePassed: manifest.pilot.qa.approved, entries: queue }, null, 2) + '\n');
      return { path: queuePath, count: queue.length, ids: queue.map((entry) => entry.id), pilotGatePassed: manifest.pilot.qa.approved };
    },
    async classify(reviewPath) {
      const manifest = await load();
      const review = JSON.parse(await fs.readFile(reviewPath, 'utf8'));
      assert(review.schemaVersion === 1 && Array.isArray(review.entries), 'Invalid eligibility review schema');
      assert(review.entries.length === catalog.length, 'Eligibility review must cover the complete catalog');
      const seen = new Set();
      const sharingUpdates = [];
      for (const item of review.entries) {
        assert(!seen.has(item.id), `Duplicate review ID: ${item.id}`);
        seen.add(item.id);
        const entry = entryById(manifest, item.id);
        assert(['eligible', 'excluded'].includes(item.eligibility), `Invalid eligibility for ${item.id}`);
        assert(typeof item.depictedMeaning === 'string' && item.depictedMeaning.trim(), `Missing depicted meaning for ${item.id}`);
        assert(item.eligibility !== 'excluded' || (typeof item.exclusionReason === 'string' && item.exclusionReason.trim()), `Missing exclusion reason for ${item.id}`);
        assert(!pilotIds.includes(item.id) || item.eligibility === 'eligible', `Pilot subject cannot be excluded: ${item.id}`);
        if (entry.sense !== item.depictedMeaning.trim() || entry.eligibility !== item.eligibility) {
          invalidatePilot(manifest, entry.id);
          if (entry.status === 'approved') {
            entry.status = 'generated';
            entry.review = null;
          }
        }
        entry.eligibility = item.eligibility;
        entry.sense = item.depictedMeaning.trim();
        entry.reason = item.eligibility === 'excluded' ? item.exclusionReason.trim() : 'Reviewed recognizable depiction';
        if (Object.hasOwn(item, 'sharedWith')) sharingUpdates.push({ entry, item });
      }
      for (const { entry, item } of sharingUpdates) {
        if (item.sharedWith === null) clearSharing(entry);
        else if (item.equivalenceReason?.trim()) recordSharing(manifest, entry, item.sharedWith, item.equivalenceReason);
        else {
          assert(!entry.sharedWith || entry.sharedWith === item.sharedWith,
            `An equivalenceReason is required to change the shared source: ${entry.id}`);
          entry.sharedWith = item.sharedWith;
        }
      }
      upgradeLegacySharing(manifest);
      validateSharing(manifest);
      manifest.eligibilityReview = { path: path.relative(root, path.resolve(reviewPath)), sha256: sha256(await fs.readFile(reviewPath)), reviewedAt: now() };
      await save(manifest);
      await emitServerSenses(manifest);
      await emitEligibility(manifest);
      return summarizeManifest(manifest);
    },
    async aliases(reviewPath) {
      const manifest = await load();
      const source = await fs.readFile(reviewPath);
      const review = JSON.parse(source.toString('utf8'));
      assert(review.schemaVersion === 1 && Array.isArray(review.entries), 'Invalid alias review schema');
      const seen = new Set();
      for (const item of review.entries) {
        assert(!seen.has(item.id), `Duplicate alias review ID: ${item.id}`);
        seen.add(item.id);
        const entry = entryById(manifest, item.id);
        assert(typeof item.equivalenceReason === 'string' && item.equivalenceReason.trim(),
          `An equivalenceReason is required for ${item.id}`);
        if (item.sharedWith === null) clearSharing(entry);
        else recordSharing(manifest, entry, item.sharedWith, item.equivalenceReason);
      }
      upgradeLegacySharing(manifest);
      validateSharing(manifest);
      manifest.aliasReview = { path: path.relative(root, path.resolve(reviewPath)), sha256: sha256(source), reviewedAt: now() };
      await save(manifest);
      await emitServerSenses(manifest);
      await emitEligibility(manifest);
      return summarizeManifest(manifest);
    },
    async import(id, filename, promptFile, promptVersion) {
      const manifest = await load();
      const entry = entryById(manifest, id);
      assert(entry.eligibility === 'eligible', `Classify ${id} as eligible before importing`);
      assert(!entry.sharedWith, `Import the shared source ${entry.sharedWith} instead`);
      assert(manifest.pilot.qa.approved || manifest.pilot.entryIds.includes(id), 'Complete the pilot QA gate before importing other subjects');
      const checked = await inspectFile(path.resolve(filename));
      assert(!manifest.entries.some((other) => other.id !== id && !other.sharedWith &&
        other.original?.sha256 === checked.sha256), 'This original belongs to another subject; use explicit reviewed sharing for equivalent words');
      const extension = checked.metadata.format === 'jpeg' ? 'jpg' : checked.metadata.format;
      assert(['png', 'webp', 'jpg', 'avif', 'tiff'].includes(extension), 'Unsupported original image format');
      const originalPath = `${PIPELINE_ROOT}/originals/${id}/${checked.sha256}.${extension}`;
      await fs.mkdir(path.dirname(absolute(originalPath)), { recursive: true });
      try { await fs.writeFile(absolute(originalPath), checked.source, { flag: 'wx' }); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        assert(sha256(await fs.readFile(absolute(originalPath))) === checked.sha256, 'Existing original hash does not match');
      }
      const processed = await sharp(checked.source).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality: 82, alphaQuality: 100, effort: 6 }).toBuffer();
      const processedHash = sha256(processed);
      const processedPath = `${PIPELINE_ROOT}/processed/${id}/${processedHash}.webp`;
      await fs.mkdir(path.dirname(absolute(processedPath)), { recursive: true });
      await fs.writeFile(absolute(processedPath), processed);
      await inspectFile(absolute(processedPath), 512);
      const unchanged = entry.original?.sha256 === checked.sha256 && entry.processed?.sha256 === processedHash;
      entry.original = { path: originalPath, sha256: checked.sha256, width: checked.metadata.width, height: checked.metadata.height };
      entry.processed = { path: processedPath, sha256: processedHash, width: 512, height: 512, bytes: processed.length };
      if (!unchanged) {
        if (entry.promptProvenance) {
          entry.previousPromptProvenance ??= [];
          entry.previousPromptProvenance.push(entry.promptProvenance);
        }
        entry.promptProvenance = null;
        entry.status = 'generated';
        entry.review = null;
        invalidatePilot(manifest, id);
      }
      if (promptFile) await attachPrompt(entry, promptFile, promptVersion);
      await save(manifest);
      return { id, status: entry.status, original: entry.original, processed: entry.processed, alpha: checked.alpha,
        promptRecorded: Boolean(entry.promptProvenance), exceedsAssetBudget: processed.length > MAX_ASSET_BYTES };
    },
    async recordPrompt(id, filename, promptVersion) {
      const manifest = await load();
      const entry = entryById(manifest, id);
      assert(!entry.sharedWith, `Record the prompt for shared source ${entry.sharedWith}`);
      await attachPrompt(entry, filename, promptVersion);
      await save(manifest);
      return { id, promptSha256: entry.promptProvenance.sha256, originalSha256: entry.promptProvenance.originalSha256 };
    },
    async review(id, decision, notes, promptFile, promptVersion) {
      assert(['approved', 'rejected'].includes(decision), 'Review must be approved or rejected');
      assert(typeof notes === 'string' && notes.trim(), 'Visual review notes are required');
      const manifest = await load();
      const entry = entryById(manifest, id);
      assert(entry.eligibility === 'eligible' && !entry.sharedWith, 'Review an eligible direct artwork entry');
      await checkArtifacts(entry);
      if (promptFile) await attachPrompt(entry, promptFile, promptVersion);
      if (decision === 'approved') checkPrompt(entry);
      entry.status = decision;
      entry.review = { decision, notes: notes.trim(), reviewedAt: now() };
      invalidatePilot(manifest, id);
      await save(manifest);
      return { id, status: entry.status, review: entry.review };
    },
    async pilotQa(notes, checks) {
      assert(typeof notes === 'string' && notes.trim(), 'Pilot QA notes are required');
      assert(['visual', 'interaction', 'offline'].every((check) => checks.includes(check)), 'Record visual, interaction, and offline checks');
      const manifest = await load();
      for (const id of manifest.pilot.entryIds) {
        const entry = entryById(manifest, id);
        assert(entry.eligibility === 'eligible' && effectiveEntry(manifest, entry)?.status === 'approved', `Pilot artwork has not been approved: ${id}`);
        await checkArtifacts(effectiveEntry(manifest, entry));
        checkPrompt(effectiveEntry(manifest, entry));
      }
      const validation = await this.validate();
      assert(validation.valid, `Build and validate the pilot before recording QA: ${validation.errors.join('; ')}`);
      assert(validation.bundle.oversized.length === 0 && validation.bundle.averageBytes <= TARGET_AVERAGE_BYTES,
        'Pilot runtime images must meet the 40 KiB average and 100 KiB per-image budgets');
      manifest.pilot.qa = { approved: true, checks: ['visual', 'interaction', 'offline'], notes: notes.trim(), reviewedAt: now() };
      await save(manifest);
      return manifest.pilot.qa;
    },
    async releaseQa(evidenceFile) {
      const manifest = await load();
      const validation = await this.validate();
      assert(validation.errors.every((error) => error.startsWith('Final release ')) &&
        summarizeManifest(manifest).artworkReady,
      'Complete and validate the full artwork library before recording final release QA');
      const proof = JSON.parse(await fs.readFile(evidenceFile, 'utf8'));
      assert(proof.productionBuild?.configuration === 'production' &&
        typeof proof.productionBuild.buildId === 'string' && proof.productionBuild.buildId.trim(),
      'Final QA requires an explicitly identified production build');
      assert(['device-network-disabled', 'production-network-denial'].includes(proof.offline?.method),
        'Record whether offline testing disabled device networking or denied networking in the production build');
      assert(typeof proof.voiceOver?.device === 'string' && proof.voiceOver.device.trim(),
        'VoiceOver evidence must identify the tested device');
      assert(Array.isArray(proof.languageReview?.languages) && proof.languageReview.languages.length > 0 &&
        proof.languageReview.languages.every((language) => typeof language === 'string' && language.trim()) &&
        proof.languageReview.languages.some(nonEnglishLanguage),
      'Language evidence must identify reviewed non-English languages');
      const evidence = {};
      for (const name of ['productionBuild', 'offline', 'voiceOver', 'languageReview']) {
        const item = proof[name];
        assert(typeof item.notes === 'string' && item.notes.trim(), `Specific ${name} findings are required`);
        assert(typeof item.evidencePath === 'string', `${name} evidencePath is required`);
        const bytes = await fs.readFile(absolute(item.evidencePath, 'output'));
        assert(bytes.length > 0, `${name} evidence file is empty`);
        evidence[name] = { ...item, notes: item.notes.trim(), sha256: sha256(bytes) };
      }
      manifest.releaseQa = { approved: true, artworkFingerprint: releaseArtworkFingerprint(manifest),
        reviewedAt: now(), evidence };
      await save(manifest);
      return { artworkReady: true, releaseReady: true, releaseQa: manifest.releaseQa };
    },
    async build() {
      const manifest = await load();
      const sources = new Map();
      for (const entry of manifest.entries) {
        assert(catalog.some((candidate) => candidate.id === entry.id), `Unknown registry ID: ${entry.id}`);
        const source = effectiveEntry(manifest, entry);
        if (entry.sharedWith) assert(canShareArtwork(entry, source, pilotIds), `Invalid registry sharing source: ${entry.id}`);
        if (entry.eligibility === 'eligible' && source?.status === 'approved') sources.set(source.id, source);
      }
      for (const source of sources.values()) {
        assert(catalog.some((entry) => entry.id === source.id), `Unknown approved source ID: ${source.id}`);
        assert(source.review?.decision === 'approved' && source.review?.notes?.trim(), `Missing visual approval for ${source.id}`);
        await checkArtifacts(source);
        checkPrompt(source);
      }
      const runtimeDir = path.join(root, RUNTIME_ROOT);
      await fs.mkdir(runtimeDir, { recursive: true });
      for (const source of sources.values()) await fs.copyFile(absolute(source.processed.path), path.join(runtimeDir, `${source.id}.webp`));
      const catalogIds = new Set(catalog.map((entry) => entry.id));
      for (const filename of await fs.readdir(runtimeDir)) {
        const id = filename.replace(/\.webp$/, '');
        if (filename.endsWith('.webp') && catalogIds.has(id) && !sources.has(id)) await fs.unlink(path.join(runtimeDir, filename));
      }
      await fs.mkdir(path.join(root, 'data'), { recursive: true });
      await fs.writeFile(path.join(root, REGISTRY_PATH), registrySource(manifest));
      await emitServerSenses(manifest);
      await emitEligibility(manifest);
      return { uniqueAssets: sources.size, registry: REGISTRY_PATH, eligibility: ELIGIBILITY_PATH, serverSensesPath };
    },
    async validate() {
      const manifest = await load();
      const errors = [];
      const warnings = [];
      const expected = new Set(catalog.map((entry) => entry.id));
      const catalogById = new Map(catalog.map((entry) => [entry.id, entry]));
      const seen = new Set();
      const checkedSources = new Set();
      const originalOwners = new Map();
      if (JSON.stringify(manifest.pilot.entryIds) !== JSON.stringify(pilotIds)) errors.push('Pilot inventory does not match the approved pilot');
      if (manifest.pilot.qa.approved && !(['visual', 'interaction', 'offline'].every((check) =>
        manifest.pilot.qa.checks?.includes(check)) && manifest.pilot.qa.notes?.trim())) errors.push('Pilot QA approval is incomplete');
      for (const entry of manifest.entries) {
        if (!expected.has(entry.id)) errors.push(`Unknown ID: ${entry.id}`);
        if (seen.has(entry.id)) errors.push(`Duplicate ID: ${entry.id}`);
        seen.add(entry.id);
        const canonical = catalogById.get(entry.id);
        if (canonical && ['word', 'categoryId', 'difficulty'].some((key) => canonical[key] !== entry[key])) errors.push(`Catalog metadata mismatch: ${entry.id}`);
        if (!ELIGIBILITIES.includes(entry.eligibility) || !STATUSES.includes(entry.status)) errors.push(`Invalid state: ${entry.id}`);
        if (!entry.reason?.trim() || !entry.sense?.trim()) errors.push(`Missing meaning or reason: ${entry.id}`);
        const source = effectiveEntry(manifest, entry);
        if (entry.sharedWith && !canShareArtwork(entry, source, pilotIds)) errors.push(`Invalid or stale reviewed equivalence: ${entry.id}`);
        if (source && ['generated', 'approved', 'rejected'].includes(source.status) && !checkedSources.has(source.id)) {
          checkedSources.add(source.id);
          if (source.original?.sha256) {
            const previousOwner = originalOwners.get(source.original.sha256);
            if (previousOwner) errors.push(`Unreviewed shared original: ${previousOwner}, ${source.id}`);
            else originalOwners.set(source.original.sha256, source.id);
          }
          try { await checkArtifacts(source); } catch (error) { errors.push(`${source.id}: ${error.message}`); }
        }
        if (entry.eligibility === 'eligible' && source?.status === 'approved') {
          if (source.review?.decision !== 'approved' || !source.review?.notes?.trim()) errors.push(`Missing visual approval: ${source.id}`);
          try { checkPrompt(source); } catch (error) { errors.push(error.message); }
          try {
            const bytes = await fs.readFile(absolute(`${RUNTIME_ROOT}/${source.id}.webp`, RUNTIME_ROOT));
            if (sha256(bytes) !== source.processed?.sha256) errors.push(`Runtime hash mismatch: ${source.id}`);
          } catch { errors.push(`Missing runtime asset: ${source.id}`); }
        }
      }
      for (const id of expected) if (!seen.has(id)) errors.push(`Missing catalog ID: ${id}`);
      try {
        if (await fs.readFile(path.join(root, REGISTRY_PATH), 'utf8') !== registrySource(manifest)) errors.push('Runtime registry is stale; run build');
      } catch { errors.push('Runtime registry is missing; run build'); }
      try {
        if (await fs.readFile(serverSensesPath, 'utf8') !== serverSensesSource(manifest)) errors.push('Server illustration senses are stale; run build');
      } catch { errors.push('Server illustration senses are missing; run build'); }
      try {
        if (await fs.readFile(path.join(root, ELIGIBILITY_PATH), 'utf8') !== eligibilitySource(manifest)) errors.push('Client illustration eligibility is stale; run build');
      } catch { errors.push('Client illustration eligibility is missing; run build'); }
      if (manifest.releaseQa?.approved) {
        if (!hasCompleteReleaseEvidence(manifest.releaseQa.evidence)) errors.push('Final release evidence is incomplete');
        for (const name of ['productionBuild', 'offline', 'voiceOver', 'languageReview']) {
          const evidence = manifest.releaseQa.evidence?.[name];
          try {
            if (!evidence || sha256(await fs.readFile(absolute(evidence.evidencePath, 'output'))) !== evidence.sha256) {
              errors.push(`Final release ${name} evidence is missing or changed`);
            }
          } catch { errors.push(`Final release ${name} evidence is missing or changed`); }
        }
      }
      const report = summarizeManifest(manifest);
      if (manifest.pilot.qa.approved && report.pilot.approvedArtwork !== pilotIds.length) errors.push('Pilot QA approval has unapproved artwork');
      if (report.bundle.averageBytes > TARGET_AVERAGE_BYTES) warnings.push('Average runtime asset exceeds 40 KiB target');
      for (const id of report.bundle.oversized) warnings.push(`Runtime asset exceeds 100 KiB: ${id}`);
      return { valid: errors.length === 0, errors, warnings, ...report,
        artworkReady: errors.every((error) => error.startsWith('Final release ')) && report.artworkReady,
        releaseReady: errors.length === 0 && report.releaseReady };
    },
    async report() {
      const report = await this.validate();
      const reportPath = path.join(root, PIPELINE_ROOT, 'coverage-report.json');
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
      return { path: reportPath, ...report };
    },
    async contactSheet() {
      const manifest = await load();
      const entries = manifest.entries.filter((entry) => effectiveEntry(manifest, entry)?.processed);
      const escape = (text) => text.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
      const tiles = entries.map((entry) => {
        const source = effectiveEntry(manifest, entry);
        const imagePath = path.relative(path.join(root, PIPELINE_ROOT), absolute(source.processed.path)).split(path.sep).map(encodeURIComponent).join('/');
        return `<article><h2>${escape(entry.word)}</h2><p>${escape(entry.id)} · ${escape(source.status)}</p><div class="pair"><figure class="white"><img src="${imagePath}" alt="${escape(entry.word)}"><figcaption>White</figcaption></figure><figure class="dark"><img src="${imagePath}" alt=""><figcaption>Dark</figcaption></figure></div><p>${escape(entry.sense)}</p></article>`;
      });
      const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Word artwork review</title><style>body{font:14px system-ui;margin:24px;color:#181818;background:#eee}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:20px}article{background:white;padding:16px;border:1px solid #ccc}h2{margin:0;font-size:20px}p{overflow-wrap:anywhere;color:#555}.pair{display:flex;gap:8px}figure{margin:0;flex:1;text-align:center;padding:8px}img{width:100%;max-width:160px;aspect-ratio:1;object-fit:contain}.white{background:white;border:1px solid #ddd}.dark{background:#222;color:white}</style><h1>Word artwork review</h1><p>${entries.length} generated subjects. Inspect identity, crimson accents, complete edges, real transparency, and clarity at small sizes before approving.</p><main>${tiles.join('\n')}</main></html>`;
      const filename = path.join(root, PIPELINE_ROOT, 'contact-sheet.html');
      await fs.writeFile(filename, html);
      const pngPaths = [];
      for (let offset = 0; offset < entries.length; offset += 8) {
        const page = entries.slice(offset, offset + 8);
        const composites = [];
        const width = 896;
        const height = Math.ceil(page.length / 2) * 280;
        const rectangles = [];
        const labels = [];
        for (const [index, entry] of page.entries()) {
          const left = (index % 2) * 448;
          const top = Math.floor(index / 2) * 280;
          rectangles.push(`<rect x="${left + 8}" y="${top + 52}" width="208" height="208" fill="#fff" stroke="#ccc"/><rect x="${left + 224}" y="${top + 52}" width="208" height="208" fill="#222"/>`);
          labels.push(`<text x="${left + 12}" y="${top + 23}" font-size="18">${escape(entry.word)}</text><text x="${left + 12}" y="${top + 42}" font-size="11" fill="#555">${escape(entry.id)}</text>`);
          const source = effectiveEntry(manifest, entry);
          const preview = await sharp(absolute(source.processed.path)).resize(200, 200, { fit: 'contain' }).png().toBuffer();
          composites.push({ input: preview, left: left + 12, top: top + 56 }, { input: preview, left: left + 228, top: top + 56 });
        }
        const background = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#eee"/>${rectangles.join('')}<g font-family="sans-serif" fill="#181818">${labels.join('')}</g></svg>`);
        const pngPath = path.join(root, PIPELINE_ROOT, `contact-sheet-${String(offset / 8 + 1).padStart(2, '0')}.png`);
        await sharp(background).composite(composites).png().toFile(pngPath);
        pngPaths.push(pngPath);
      }
      return { path: filename, pngPaths, count: entries.length };
    },
  };
}

async function main(args) {
  const [command, ...rest] = args;
  const option = (name) => { const index = rest.indexOf(`--${name}`); return index === -1 ? undefined : rest[index + 1]; };
  const tools = createArtworkTools();
  const commands = {
    init: () => tools.init(), inventory: () => tools.inventory(),
    queue: () => tools.queue(Number(option('limit') ?? 24)),
    classify: () => tools.classify(option('file')),
    aliases: () => tools.aliases(option('file')),
    import: () => tools.import(rest[0], rest[1], option('prompt-file'), option('prompt-version')),
    'record-prompt': () => tools.recordPrompt(rest[0], option('prompt-file'), option('prompt-version')),
    review: () => tools.review(rest[0], rest[1], option('notes'), option('prompt-file'), option('prompt-version')),
    'pilot-qa': () => tools.pilotQa(option('notes'), (option('checks') ?? '').split(',')),
    'release-qa': () => tools.releaseQa(option('evidence-file')),
    build: () => tools.build(), validate: () => tools.validate(), report: () => tools.report(),
    'contact-sheet': () => tools.contactSheet(),
  };
  assert(Object.hasOwn(commands, command), 'Use init, inventory, queue, classify --file, aliases --file, import <id> <file> --prompt-file, record-prompt <id> --prompt-file, review <id> approved|rejected --notes, pilot-qa --checks visual,interaction,offline --notes, release-qa --evidence-file, build, validate, report, or contact-sheet');
  const lockPath = path.join(defaultRoot, PIPELINE_ROOT, '.pipeline.lock');
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  let lock;
  try {
    lock = await fs.open(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another artwork command is running; run commands sequentially');
    throw error;
  }
  try {
    const result = await commands[command]();
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (command === 'validate' && !result.valid) process.exitCode = 1;
  } finally {
    await lock.close();
    await fs.unlink(lockPath);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
