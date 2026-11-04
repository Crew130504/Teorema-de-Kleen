import test from "node:test";
import assert from "node:assert/strict";
import { automatonToRegex, exampleAutomaton, parseRegex, regexToNFA, regexToString, simplifyRegex, simulate } from "../core.mjs";

test("analiza precedencia, unión, concatenación y estrella", () => {
  assert.equal(regexToString(parseRegex("a(b|c)*")), "a(b ∪ c)*");
});

test("normaliza variantes tipográficas de la estrella al copiar fórmulas", () => {
  const source = "a ∗ (ab ∪ ba) ∗ ∪ a(b ∪ a ∗)";
  const expected = "a*(ab ∪ ba)* ∪ a(b ∪ a*)";
  assert.equal(regexToString(parseRegex(source)), expected);
  assert.equal(regexToNFA(source).automaton.transitions.some(t => "∗⋆⁎＊".includes(t.symbol)), false);
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

test("simplifica identidades de lambda y estrella de Kleene", () => {
  const simplified = source => regexToString(simplifyRegex(parseRegex(source)));
  assert.equal(simplified("∅|a"), "a");
  assert.equal(simplified("λa"), "a");
  assert.equal(simplified("∅a"), "∅");
  assert.equal(simplified("λ|bb*"), "b*");
  assert.equal(simplified("λ|(ab)(ab)*"), "(ab)*");
  assert.equal(simplified("b*|b|bb*|λ"), "b*");
  assert.equal(simplified("a|aa*"), "aa*");
  assert.equal(simplified("a*a"), "aa*");
  assert.equal(simplified("a*a*"), "a*");
  assert.equal(simplified("(λ|a)*"), "a*");
  assert.equal(simplified("(aa*)*"), "a*");
  assert.equal(simplified("a*(bb*|abb*)"), "a*bb*");
  assert.equal(simplified("(bb*|bb*a)a*"), "bb*a*");
  assert.equal(simplified("ab|ac"), "a(b ∪ c)");
  assert.equal(simplified("ba|ca"), "(b ∪ c)a");
  assert.equal(simplified("b|a"), "a ∪ b");
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

test("ida y vuelta elimina redundancias producidas por transiciones lambda", () => {
  const original = regexToNFA("ab*").automaton;
  assert.equal(automatonToRegex(original).regex, "ab*");

  const repeatedPrefix = regexToNFA("a*bb*").automaton;
  assert.equal(automatonToRegex(repeatedPrefix).regex, "a*bb*");
});

test("ida y vuelta conserva la expresión normalizada si el diagrama no cambia", () => {
  const examples = [
    "ab*",
    "a*bb*",
    "a*(b|ab*|ab*a)c*|(a|b)(a|ac)*",
    "c*a(a|ba)*(abc)*|c*(a|cb*c)"
  ];
  for (const source of examples) {
    const built = regexToNFA(source);
    assert.equal(automatonToRegex(built.automaton).regex, built.normalized, source);
  }
});

test("un cambio semántico en el diagrama invalida la expresión de origen", () => {
  const { automaton, normalized } = regexToNFA("ab*");
  automaton.finals = [automaton.initial];
  assert.notEqual(automatonToRegex(automaton).regex, normalized);
});

test("el ejemplo de Arden conserva la forma algebraica usada por el libro", () => {
  const automaton = {
    states: ["q0", "q1", "q2", "q3", "q4"].map(id => ({ id, x: 0, y: 0 })),
    initial: "q0",
    finals: ["q2", "q4"],
    transitions: [
      ["q0", "q1", "a"], ["q1", "q2", "a"], ["q2", "q2", "b"],
      ["q2", "q3", "b"], ["q3", "q3", "a"], ["q3", "q4", "b"],
      ["q4", "q3", "a"], ["q4", "q2", "a"]
    ].map(([from, to, symbol], index) => ({ id: `t${index}`, from, to, symbol }))
  };
  assert.equal(
    automatonToRegex(automaton).regex,
    "aa(b ∪ b(a ∪ ba)*ba)*(b(a ∪ ba)*b ∪ λ)"
  );
});
