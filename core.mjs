export const EPSILON = "λ";
export const EMPTY = "∅";

const E_EMPTY = Object.freeze({ type: "empty" });
const E_EPS = Object.freeze({ type: "eps" });

const lit = value => ({ type: "lit", value });

function key(expr) {
  return regexToString(expr);
}

export function union(...items) {
  const flat = [];
  for (const item of items) {
    if (!item || item.type === "empty") continue;
    if (item.type === "union") flat.push(...item.items);
    else flat.push(item);
  }
  const unique = [...new Map(flat.map(item => [key(item), item])).values()];
  if (!unique.length) return E_EMPTY;
  if (unique.length === 1) return unique[0];
  return { type: "union", items: unique };
}

export function concat(...items) {
  const flat = [];
  for (const item of items) {
    if (!item || item.type === "empty") return E_EMPTY;
    if (item.type === "eps") continue;
    if (item.type === "concat") flat.push(...item.items);
    else flat.push(item);
  }
  if (!flat.length) return E_EPS;
  if (flat.length === 1) return flat[0];
  return { type: "concat", items: flat };
}

export function star(item) {
  if (!item || item.type === "empty" || item.type === "eps") return E_EPS;
  if (item.type === "star") return item;
  return { type: "star", item };
}

function precedence(expr) {
  return expr.type === "union" ? 1 : expr.type === "concat" ? 2 : expr.type === "star" ? 3 : 4;
}

export function regexToString(expr, parent = 0) {
  if (!expr || expr.type === "empty") return EMPTY;
  if (expr.type === "eps") return EPSILON;
  if (expr.type === "lit") return expr.value;
  const p = precedence(expr);
  let value = "";
  if (expr.type === "union") value = expr.items.map(x => regexToString(x, p)).join(" ∪ ");
  if (expr.type === "concat") value = expr.items.map(x => regexToString(x, p)).join("");
  if (expr.type === "star") value = regexToString(expr.item, p) + "*";
  return p < parent ? `(${value})` : value;
}

function tokenize(source) {
  const chars = [...source.replace(/\s+/g, "").replaceAll("ε", EPSILON).replaceAll("|", "∪").replaceAll("+", "∪")];
  if (!chars.length) throw new Error("Escribe una expresión regular.");
  const out = [];
  const isAtomEnd = t => t && (t.kind === "symbol" || t.value === ")" || t.value === "*");
  const isAtomStart = t => t && (t.kind === "symbol" || t.value === "(");
  for (const char of chars) {
    const token = "()∪*·.".includes(char)
      ? { kind: "op", value: char === "." ? "·" : char }
      : { kind: "symbol", value: char };
    if (isAtomEnd(out.at(-1)) && isAtomStart(token)) out.push({ kind: "op", value: "·" });
    out.push(token);
  }
  return out;
}

export function parseRegex(source) {
  const tokens = tokenize(source);
  const output = [];
  const ops = [];
  const rank = { "∪": 1, "·": 2 };
  let expectOperand = true;
  for (const token of tokens) {
    if (token.kind === "symbol") {
      if (!expectOperand) throw new Error(`Falta un operador antes de '${token.value}'.`);
      output.push(token);
      expectOperand = false;
    } else if (token.value === "(") {
      if (!expectOperand) throw new Error("Falta concatenación antes de '('.");
      ops.push(token.value);
      expectOperand = true;
    } else if (token.value === ")") {
      if (expectOperand) throw new Error("Paréntesis vacío o incompleto.");
      while (ops.length && ops.at(-1) !== "(") output.push({ kind: "op", value: ops.pop() });
      if (ops.pop() !== "(") throw new Error("Falta un paréntesis de apertura.");
      expectOperand = false;
    } else if (token.value === "*") {
      if (expectOperand) throw new Error("La estrella necesita una expresión a la izquierda.");
      output.push(token);
    } else {
      if (expectOperand) throw new Error(`El operador '${token.value}' no tiene operando izquierdo.`);
      while (ops.length && ops.at(-1) !== "(" && rank[ops.at(-1)] >= rank[token.value]) {
        output.push({ kind: "op", value: ops.pop() });
      }
      ops.push(token.value);
      expectOperand = true;
    }
  }
  if (expectOperand) throw new Error("La expresión termina con un operador incompleto.");
  while (ops.length) {
    const op = ops.pop();
    if (op === "(") throw new Error("Falta un paréntesis de cierre.");
    output.push({ kind: "op", value: op });
  }
  const stack = [];
  for (const token of output) {
    if (token.kind === "symbol") {
      stack.push(token.value === EPSILON ? E_EPS : token.value === EMPTY ? E_EMPTY : lit(token.value));
    } else if (token.value === "*") {
      if (!stack.length) throw new Error("Estrella sin operando.");
      stack.push(star(stack.pop()));
    } else {
      const right = stack.pop();
      const left = stack.pop();
      if (!left || !right) throw new Error("Expresión incompleta.");
      stack.push(token.value === "∪" ? union(left, right) : concat(left, right));
    }
  }
  if (stack.length !== 1) throw new Error("No se pudo interpretar la expresión.");
  return stack[0];
}

export function regexToNFA(source) {
  const ast = typeof source === "string" ? parseRegex(source) : source;
  let counter = 0;
  const states = [];
  const transitions = [];
  const next = () => {
    const id = `q${counter++}`;
    states.push({ id, x: 0, y: 0 });
    return id;
  };
  const edge = (from, to, symbol) => transitions.push({ id: `t${transitions.length}`, from, to, symbol });
  const place = (target, source, dx, dy) => {
    for (const [id, [x, y]] of source) target.set(id, [x + dx, y + dy]);
  };
  const loopSymbols = node => {
    if (node.type === "lit") return [node.value];
    if (node.type === "union" && node.items.every(item => item.type === "lit")) return node.items.map(item => item.value);
    return null;
  };
  const build = node => {
    if (node.type === "empty") {
      const start = next(), end = next();
      return { start, finals: [end], width: 110, height: 70, positions: new Map([[start, [0, 35]], [end, [110, 35]]]) };
    }
    if (node.type === "eps") {
      const start = next();
      return { start, finals: [start], width: 0, height: 70, positions: new Map([[start, [0, 35]]]) };
    }
    if (node.type === "lit") {
      const start = next(), end = next();
      edge(start, end, node.value);
      return { start, finals: [end], width: 110, height: 70, positions: new Map([[start, [0, 35]], [end, [110, 35]]]) };
    }
    if (node.type === "concat") {
      const parts = node.items.map(build);
      const height = Math.max(...parts.map(part => part.height));
      const positions = new Map();
      let x = 0;
      parts.forEach((part, index) => {
        place(positions, part.positions, x, (height - part.height) / 2);
        if (index < parts.length - 1) {
          for (const final of part.finals) edge(final, parts[index + 1].start, EPSILON);
          x += part.width + 70;
        }
      });
      return { start: parts[0].start, finals: parts.at(-1).finals, width: parts.reduce((sum, part) => sum + part.width, 0) + 70 * (parts.length - 1), height, positions };
    }
    if (node.type === "union") {
      const start = next();
      const parts = node.items.map(build);
      const gap = 55;
      const height = parts.reduce((sum, part) => sum + part.height, 0) + gap * (parts.length - 1);
      const positions = new Map([[start, [0, height / 2]]]);
      const finals = [];
      let y = 0;
      for (const part of parts) {
        place(positions, part.positions, 100, y);
        edge(start, part.start, EPSILON);
        finals.push(...part.finals);
        y += part.height + gap;
      }
      return { start, finals, width: 100 + Math.max(...parts.map(part => part.width)), height, positions };
    }
    if (node.type === "star") {
      const symbols = loopSymbols(node.item);
      if (symbols) {
        const start = next();
        for (const symbol of symbols) edge(start, start, symbol);
        return { start, finals: [start], width: 0, height: 70, positions: new Map([[start, [0, 35]]]) };
      }
      const item = build(node.item);
      for (const final of item.finals) if (final !== item.start) edge(final, item.start, EPSILON);
      return { ...item, finals: [...new Set([item.start, ...item.finals])] };
    }
    throw new Error("Nodo de expresión desconocido.");
  };
  const fragment = build(ast);
  const margin = 62, viewportWidth = 900, viewportHeight = 560;
  const scale = Math.min((viewportWidth - margin * 2) / Math.max(fragment.width, 1), (viewportHeight - margin * 2) / Math.max(fragment.height, 1), 1.35);
  const offsetX = (viewportWidth - fragment.width * scale) / 2;
  const offsetY = (viewportHeight - fragment.height * scale) / 2;
  for (const state of states) {
    const [x, y] = fragment.positions.get(state.id);
    state.x = offsetX + x * scale;
    state.y = offsetY + y * scale;
  }
  const automaton = { states, transitions, initial: fragment.start, finals: fragment.finals };
  return { automaton, ast, normalized: regexToString(ast) };
}

export function cloneAutomaton(automaton) {
  return JSON.parse(JSON.stringify(automaton));
}

export function validateAutomaton(automaton) {
  if (!automaton.states?.length) throw new Error("El autómata no tiene estados.");
  const ids = new Set(automaton.states.map(s => s.id));
  if (ids.size !== automaton.states.length) throw new Error("Hay nombres de estado repetidos.");
  if (!automaton.initial || !ids.has(automaton.initial)) throw new Error("Selecciona un estado inicial.");
  if (!automaton.finals?.length) throw new Error("Selecciona al menos un estado de aceptación.");
  for (const final of automaton.finals) if (!ids.has(final)) throw new Error("Hay un estado final inexistente.");
  for (const t of automaton.transitions || []) {
    if (!ids.has(t.from) || !ids.has(t.to)) throw new Error("Hay una transición con estados inexistentes.");
    if (!t.symbol?.trim()) throw new Error("Hay una transición sin símbolo.");
  }
  return true;
}

export function epsilonClosure(automaton, seeds) {
  const closure = new Set(seeds);
  const pending = [...seeds];
  while (pending.length) {
    const current = pending.pop();
    for (const t of automaton.transitions) {
      if (t.from === current && (t.symbol === EPSILON || t.symbol === "ε")) {
        if (!closure.has(t.to)) { closure.add(t.to); pending.push(t.to); }
      }
    }
  }
  return closure;
}

export function simulate(automaton, text) {
  validateAutomaton(automaton);
  let active = epsilonClosure(automaton, [automaton.initial]);
  const path = [{ symbol: EPSILON, states: [...active] }];
  for (const symbol of [...text]) {
    const next = new Set();
    for (const state of active) {
      for (const t of automaton.transitions) if (t.from === state && t.symbol === symbol) next.add(t.to);
    }
    active = epsilonClosure(automaton, next);
    path.push({ symbol, states: [...active] });
  }
  return { accepted: [...active].some(s => automaton.finals.includes(s)), path };
}

export function eliminateEpsilon(automaton) {
  validateAutomaton(automaton);
  const result = cloneAutomaton(automaton);
  const symbols = [...new Set(automaton.transitions.map(t => t.symbol).filter(s => s !== EPSILON && s !== "ε"))];
  const transitions = [];
  for (const state of automaton.states) {
    const fromClosure = epsilonClosure(automaton, [state.id]);
    for (const symbol of symbols) {
      const moved = new Set();
      for (const from of fromClosure) {
        for (const t of automaton.transitions) if (t.from === from && t.symbol === symbol) moved.add(t.to);
      }
      const targets = epsilonClosure(automaton, moved);
      for (const to of targets) transitions.push({ id: `t${transitions.length}`, from: state.id, to, symbol });
    }
  }
  result.transitions = transitions;
  result.finals = automaton.states
    .filter(s => [...epsilonClosure(automaton, [s.id])].some(x => automaton.finals.includes(x)))
    .map(s => s.id);
  return result;
}

function exprFromLabel(value) {
  if (value === EPSILON || value === "ε") return E_EPS;
  if (value === EMPTY) return E_EMPTY;
  return lit(value);
}

function eqToString(name, row, constant, names) {
  const terms = names.map(n => row.get(n)?.type !== "empty" ? `${regexToString(row.get(n), 2)}${n}` : null).filter(Boolean);
  if (constant.type !== "empty") terms.push(regexToString(constant));
  return `${name} = ${terms.length ? terms.join(" ∪ ") : EMPTY}`;
}

export function automatonToRegex(input) {
  validateAutomaton(input);
  const hadEpsilon = input.transitions.some(t => t.symbol === EPSILON || t.symbol === "ε");
  const automaton = hadEpsilon ? eliminateEpsilon(input) : cloneAutomaton(input);
  const names = automaton.states.map(s => s.id);
  const coeff = new Map(names.map(i => [i, new Map(names.map(j => [j, E_EMPTY]))]));
  const constant = new Map(names.map(i => [i, automaton.finals.includes(i) ? E_EPS : E_EMPTY]));
  for (const t of automaton.transitions) {
    const row = coeff.get(t.from);
    row.set(t.to, union(row.get(t.to), exprFromLabel(t.symbol)));
  }
  const equations = names.map(i => eqToString(`A_${i}`, new Map(names.map(j => [`A_${j}`, coeff.get(i).get(j)])), constant.get(i), names.map(j => `A_${j}`)));
  const steps = [];
  const remaining = new Set(names);
  const order = names.filter(n => n !== automaton.initial).reverse();
  for (const k of order) {
    const loop = coeff.get(k).get(k);
    const factor = star(loop);
    const solvedConstant = concat(factor, constant.get(k));
    const solved = new Map();
    for (const j of remaining) if (j !== k) solved.set(j, concat(factor, coeff.get(k).get(j)));
    const rhs = [...solved.entries()].filter(([, e]) => e.type !== "empty").map(([j, e]) => `${regexToString(e, 2)}A_${j}`);
    if (solvedConstant.type !== "empty") rhs.push(regexToString(solvedConstant));
    steps.push({
      title: `Eliminar A_${k}`,
      detail: loop.type === "empty"
        ? `No hay lazo propio. Se sustituye A_${k} = ${rhs.join(" ∪ ") || EMPTY}.`
        : `Por Arden: A_${k} = ${rhs.join(" ∪ ") || EMPTY}.`
    });
    for (const i of remaining) {
      if (i === k) continue;
      const via = coeff.get(i).get(k);
      if (via.type === "empty") continue;
      for (const j of remaining) {
        if (j === k) continue;
        coeff.get(i).set(j, union(coeff.get(i).get(j), concat(via, solved.get(j))));
      }
      constant.set(i, union(constant.get(i), concat(via, solvedConstant)));
      coeff.get(i).set(k, E_EMPTY);
    }
    remaining.delete(k);
  }
  const startName = automaton.initial;
  const self = coeff.get(startName).get(startName);
  const result = concat(star(self), constant.get(startName));
  steps.push({
    title: `Resolver A_${startName}`,
    detail: `Aplicando Arden por última vez: A_${startName} = ${regexToString(result)}.`
  });
  return { regex: regexToString(result), equations, steps, hadEpsilon, normalizedAutomaton: automaton };
}

export function autoLayout(automaton, width = 900, height = 560) {
  if (!automaton.states.length) return automaton;
  const levels = new Map([[automaton.initial || automaton.states[0].id, 0]]);
  const queue = [automaton.initial || automaton.states[0].id];
  while (queue.length) {
    const from = queue.shift();
    for (const t of automaton.transitions) if (t.from === from && !levels.has(t.to)) {
      levels.set(t.to, levels.get(from) + 1); queue.push(t.to);
    }
  }
  let nextLevel = Math.max(0, ...levels.values()) + 1;
  for (const state of automaton.states) if (!levels.has(state.id)) levels.set(state.id, nextLevel++);
  const groups = new Map();
  for (const state of automaton.states) {
    const level = levels.get(state.id);
    if (!groups.has(level)) groups.set(level, []);
    groups.get(level).push(state);
  }
  const sorted = [...groups.entries()].sort((a, b) => a[0] - b[0]);
  sorted.forEach(([_, group], column) => group.forEach((state, row) => {
    state.x = sorted.length === 1 ? width / 2 : 90 + column * ((width - 180) / (sorted.length - 1));
    state.y = height / (group.length + 1) * (row + 1);
  }));
  return automaton;
}

export function exampleAutomaton() {
  return {
    states: [
      { id: "q0", x: 120, y: 280 }, { id: "q1", x: 320, y: 280 },
      { id: "q2", x: 520, y: 280 }, { id: "q3", x: 720, y: 280 }
    ],
    initial: "q0",
    finals: ["q2", "q3"],
    transitions: [
      { id: "t0", from: "q0", to: "q1", symbol: "b" },
      { id: "t1", from: "q1", to: "q1", symbol: "b" },
      { id: "t2", from: "q1", to: "q2", symbol: "a" },
      { id: "t3", from: "q2", to: "q3", symbol: "b" },
      { id: "t4", from: "q3", to: "q2", symbol: "b" },
      { id: "t5", from: "q3", to: "q3", symbol: "a" }
    ]
  };
}
