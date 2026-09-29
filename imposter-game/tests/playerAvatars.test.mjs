import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { assignPlayerAvatars, cyclePlayerAvatar, shufflePlayerAvatars, MAX_PLAYERS, PLAYER_AVATARS } from '../game/playerAvatars.ts';
import { buildRound } from '../game/round.ts';
import { createInitialState, gameReducer, initialState } from '../game/state.ts';

const makePlayers = (count) => Array.from({ length: count }, (_, index) => ({
  id: `player-${index + 1}`, name: `Player ${index + 1}`,
}));

test('fresh sessions shuffle unique avatars without changing the default state or prior sessions', () => {
  const original = structuredClone(initialState);
  const first = createInitialState(() => 0);
  const second = createInitialState(() => 0.99);
  assert.notDeepEqual(first.setupPreferences.players, second.setupPreferences.players);
  assert.deepEqual(initialState, original);
  assert.deepEqual(first.setupPreferences.players.map(({ avatarId, ...player }) => player),
    original.setupPreferences.players.map(({ avatarId, ...player }) => player));
  for (let count = 3; count <= MAX_PLAYERS; count++) {
    const players = makePlayers(count);
    const shuffled = shufflePlayerAvatars(players, () => 0.4);
    assert.equal(new Set(shuffled.map((player) => player.avatarId)).size, count);
    assert.ok(players.every((player) => player.avatarId === undefined));
  }
  first.setupPreferences.players[0].name = 'Alex';
  first.setupPreferences.selectedCategoryIds.push('food');
  assert.deepEqual(second, createInitialState(() => 0.99));
  assert.deepEqual(initialState, original);
});

test('tapping cycles through unused avatars, wraps around and preserves other players', () => {
  for (let count = 3; count < MAX_PLAYERS; count++) {
    const original = assignPlayerAvatars(makePlayers(count));
    original[0].languageId = 'uzbek';
    let players = original;
    const seen = new Set([players[0].avatarId]);
    for (let tap = 0; tap < MAX_PLAYERS; tap++) {
      const previous = players;
      players = cyclePlayerAvatar(previous, previous[0].id);
      assert.notEqual(players[0].avatarId, previous[0].avatarId);
      assert.equal(players[0].languageId, 'uzbek');
      assert.equal(new Set(players.map((player) => player.avatarId)).size, count);
      assert.deepEqual(players.slice(1), original.slice(1));
      seen.add(players[0].avatarId);
    }
    assert.equal(seen.size, MAX_PLAYERS - count + 1);
    assert.equal(original[0].avatarId, 'duck');
  }
});

test('a full group swaps only two avatars so tapping always works without duplicates', () => {
  let players = assignPlayerAvatars(makePlayers(MAX_PLAYERS));
  for (let tap = 0; tap < MAX_PLAYERS; tap++) {
    const previous = players;
    const oldAvatar = previous[0].avatarId;
    players = cyclePlayerAvatar(previous, previous[0].id);
    assert.notEqual(players[0].avatarId, oldAvatar);
    assert.equal(new Set(players.map((player) => player.avatarId)).size, MAX_PLAYERS);
    const swappedIndex = previous.findIndex((player) => player.avatarId === players[0].avatarId);
    assert.equal(players[swappedIndex].avatarId, oldAvatar);
    assert.equal(players.filter((player, index) => player.avatarId !== previous[index].avatarId).length, 2);
    assert.deepEqual(players.map(({ avatarId, ...player }) => player),
      previous.map(({ avatarId, ...player }) => player));
  }
});

test('avatar changes are limited to setup and stay selected after leaving a round', () => {
  const launch = createInitialState(() => 0.25);
  const action = { type: 'changePlayerAvatar', playerId: launch.setupPreferences.players[0].id };
  const changed = gameReducer(launch, action);
  assert.notEqual(changed.setupPreferences.players[0].avatarId, launch.setupPreferences.players[0].avatarId);
  assert.equal(gameReducer(changed, { ...action, playerId: 'missing' }), changed);
  for (const phase of ['reveal', 'playing', 'completed']) {
    const active = { ...changed, phase };
    assert.equal(gameReducer(active, action), active);
  }
  assert.deepEqual(gameReducer({ ...changed, phase: 'completed' }, { type: 'resetGame' }).setupPreferences,
    changed.setupPreferences);
});

test('every supported group size gets distinct avatars without mutating players', () => {
  assert.equal(MAX_PLAYERS, 10);
  assert.equal(new Set(PLAYER_AVATARS.map((avatar) => avatar.id)).size, MAX_PLAYERS);
  for (let count = 3; count <= MAX_PLAYERS; count++) {
    const players = makePlayers(count);
    const assigned = assignPlayerAvatars(players);
    assert.equal(new Set(assigned.map((player) => player.avatarId)).size, count);
    assert.ok(players.every((player) => player.avatarId === undefined));
    assert.deepEqual(assignPlayerAvatars(assigned), assigned);
  }
});

test('removing, reordering and replacing a player preserves everyone else’s character', () => {
  const original = assignPlayerAvatars(makePlayers(10));
  const removed = original[4];
  const remaining = original.filter((player) => player.id !== removed.id).reverse();
  const replacement = { id: 'player-11', name: 'New player', languageId: 'uzbek' };
  const assigned = assignPlayerAvatars([replacement, ...remaining]);
  assert.equal(assigned[0].avatarId, removed.avatarId);
  assert.equal(assigned[0].languageId, 'uzbek');
  assert.deepEqual(assigned.slice(1), remaining);
  assert.equal(new Set(assigned.map((player) => player.avatarId)).size, 10);
});

test('missing, duplicate and unknown assignments are repaired without displacing valid ones', () => {
  const assigned = assignPlayerAvatars([
    { id: 'new', name: 'New' },
    { id: 'reserved', name: 'Reserved', avatarId: 'duck' },
    { id: 'duplicate', name: 'Duplicate', avatarId: 'duck' },
    { id: 'unknown', name: 'Unknown', avatarId: 'missing-avatar' },
  ]);
  assert.equal(assigned[1].avatarId, 'duck');
  assert.equal(new Set(assigned.map((player) => player.avatarId)).size, 4);
});

test('avatars survive name edits, role changes, replay and returning to setup', () => {
  let state = gameReducer(initialState, {
    type: 'updateSetupPreferences', preferences: { players: makePlayers(10) },
  });
  const original = state.setupPreferences.players;
  state = gameReducer(state, {
    type: 'updateSetupPreferences',
    preferences: { players: original.map(({ id, name }, index) => ({
      id, name: index === 0 ? 'Alex' : name,
    })) },
  });
  assert.deepEqual(state.setupPreferences.players.map((player) => player.avatarId),
    original.map((player) => player.avatarId));

  const imposterIds = new Set();
  for (const random of [0, 0.5, 0.99]) {
    const round = buildRound({
      players: state.setupPreferences.players.map(({ id, name }) => ({ id, name })),
      categoryIds: ['food'], difficulty: 'easy', languageId: 'english', languageName: 'English',
      secretWord: 'Apple', imposterHint: 'Orchard', rng: () => random,
    });
    state = gameReducer(state, { type: 'startRound', round });
    assert.deepEqual(state.round.players.map((player) => player.avatarId),
      original.map((player) => player.avatarId));
    assert.deepEqual(state.round.cards, round.cards);
    imposterIds.add(state.round.imposterPlayerId);
    state = gameReducer(state, { type: 'resetGame' });
  }
  assert.equal(imposterIds.size, 3);
  assert.equal(state.setupPreferences.players[0].name, 'Alex');
});

test('every character has distinct bundled artwork at a suitable resolution', () => {
  const fingerprints = new Set();
  for (const avatar of PLAYER_AVATARS) {
    const image = readFileSync(new URL(`../assets/avatars/${avatar.id}.png`, import.meta.url));
    assert.deepEqual(image.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(image.readUInt32BE(16), 256);
    assert.equal(image.readUInt32BE(20), 256);
    fingerprints.add(createHash('sha256').update(image).digest('hex'));
  }
  assert.equal(fingerprints.size, MAX_PLAYERS);
});
