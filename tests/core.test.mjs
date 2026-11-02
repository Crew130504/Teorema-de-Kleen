import test from "node:test";
import assert from "node:assert/strict";
import { automatonToRegex, exampleAutomaton, parseRegex, regexToNFA, regexToString, simulate } from "../core.mjs";

test("analiza precedencia, unión, concatenación y estrella", () => {
  assert.equal(regexToString(parseRegex("a(b|c)*")), "a(b ∪ c)*");
});

test("la construcción recursiva de la Parte I conserva el lenguaje", () => {
  const { automaton } = regexToNFA("(a|b)*abb");
  assert.equal(simulate(automaton, "abb").accepted, true);
  assert.equal(simulate(automaton, "aabb").accepted, true);
  assert.equal(simulate(automaton, "aba").accepted, false);
});

test("una estrella de símbolo se dibuja como un lazo", () => {
  const automaton = regexToNFA("a*").automaton;
  assert.equal(automaton.states.length, 1);
  assert.deepEqual(automaton.finals, [automaton.initial]);
  assert.deepEqual(automaton.transitions.map(({ from, to, symbol }) => ({ from, to, symbol })), [{ from: automaton.initial, to: automaton.initial, symbol: "a" }]);
});

test("los ejercicios de clase usan la construcción simplificada esperada", () => {
  assert.equal(regexToNFA("a*(b|ab*|ab*a)c*|(a|b)(a|ac)*").automaton.states.length, 26);
  assert.equal(regexToNFA("c*a(a|ba)*(abc)*|c*(a|cb*c)").automaton.states.length, 26);
});

test("la expresión vacía y lambda se distinguen", () => {
  assert.equal(simulate(regexToNFA("λ").automaton, "").accepted, true);
  assert.equal(simulate(regexToNFA("∅").automaton, "").accepted, false);
});

test("parte II produce una expresión y pasos de Arden", () => {
  const result = automatonToRegex(exampleAutomaton());
  assert.ok(result.regex.length > 0);
  assert.equal(result.equations.length, 4);
  assert.equal(result.steps.at(-1).title, "Resolver A_q0");
});

test("ida y vuelta conserva muestras del lenguaje", () => {
  const original = exampleAutomaton();
  const regex = automatonToRegex(original).regex;
  const rebuilt = regexToNFA(regex).automaton;
  const samples = ["", "b", "ba", "bab", "baba", "bbab", "baa"];
  for (const word of samples) assert.equal(simulate(rebuilt, word).accepted, simulate(original, word).accepted, word);
});
