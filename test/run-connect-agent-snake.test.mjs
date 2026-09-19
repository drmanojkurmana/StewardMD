/* connect-agent-snake.js is a browser IIFE; load it under a minimal fake window in a vm context
 * and drive it through its real public API (SMD_SNAKE.tick) rather than re-implementing the rules.
 */
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadSnake() {
  const src = readFileSync(join(ROOT, "connect-agent-snake.js"), "utf8");
  const window = {};
  const context = vm.createContext({ window: window, Math: Math });
  vm.runInContext(src, context);
  return window.SMD_SNAKE;
}

function baseState(overrides) {
  return Object.assign({
    cols: 5, rows: 5,
    snake: [[2, 2], [1, 2], [0, 2]],
    food: [4, 4],
    dir: "right",
    score: 0,
    dead: false
  }, overrides);
}

test("moves the head one cell in the current direction", () => {
  const { tick } = loadSnake();
  const state = baseState();
  const next = tick(state);
  assert.deepEqual(next.snake[0], [3, 2]);
  assert.equal(next.snake.length, state.snake.length);
  assert.equal(next.dead, false);
});

test("ignores a reversal of the current direction", () => {
  const { tick } = loadSnake();
  const state = baseState({ dir: "right" });
  const next = tick(state, "left");
  assert.equal(next.dir, "right");
  assert.deepEqual(next.snake[0], [3, 2]);
});

test("grows and scores when the head reaches food", () => {
  const { tick } = loadSnake();
  const state = baseState({
    snake: [[3, 2], [2, 2], [1, 2]],
    food: [4, 2],
    random: () => 0
  });
  const next = tick(state);
  assert.deepEqual(next.snake[0], [4, 2]);
  assert.equal(next.snake.length, state.snake.length + 1);
  assert.equal(next.score, 1);
  assert.notDeepEqual(next.food, [4, 2]);
});

test("dies on hitting the wall", () => {
  const { tick } = loadSnake();
  const state = baseState({
    snake: [[4, 2], [3, 2], [2, 2]],
    dir: "right"
  });
  const next = tick(state);
  assert.equal(next.dead, true);
});

test("dies on self-collision", () => {
  const { tick } = loadSnake();
  // Snake curled back on itself: moving left runs the head into a body
  // segment that is not the tail (the tail alone would just slide away).
  const state = baseState({
    snake: [[2, 2], [2, 3], [1, 3], [1, 2], [1, 1]],
    dir: "up"
  });
  const next = tick(state, "left");
  assert.equal(next.dead, true);
});

test("does not mutate the input state", () => {
  const { tick } = loadSnake();
  const state = baseState();
  const snapshot = JSON.parse(JSON.stringify(state));
  tick(state, "up");
  assert.deepEqual(state, snapshot);
});
