import {
  EPSILON, autoLayout, automatonToRegex, cloneAutomaton, exampleAutomaton,
  parseRegex, regexToNFA, regexToString, simulate, validateAutomaton
} from "./core.mjs?v=5";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const svgNS = "http://www.w3.org/2000/svg";

let automaton = { states: [], transitions: [], initial: null, finals: [] };
let tool = "select";
let selection = null;
let transitionOrigin = null;
let pendingTransition = null;
let dragging = null;
let dragSnapshot = null;
let activeStates = new Set();
let undoStack = [];
let redoStack = [];
let toastTimer;

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1900);
}

function snapshot() { return cloneAutomaton(automaton); }
function commit(previous = snapshot()) {
  undoStack.push(previous);
  if (undoStack.length > 60) undoStack.shift();
  redoStack = [];
  updateHistoryButtons();
}
function updateHistoryButtons() {
  $("#undoButton").disabled = !undoStack.length;
  $("#redoButton").disabled = !redoStack.length;
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  automaton = undoStack.pop();
  selection = null; render(); updateHistoryButtons(); toast("Cambio deshecho");
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  automaton = redoStack.pop();
  selection = null; render(); updateHistoryButtons(); toast("Cambio rehecho");
}

function svgEl(name, attrs = {}) {
  const node = document.createElementNS(svgNS, name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

function canvasPoint(event) {
  const svg = $("#automatonCanvas");
  const point = svg.createSVGPoint();
  point.x = event.clientX; point.y = event.clientY;
  return point.matrixTransform(svg.getScreenCTM().inverse());
}

function stateById(id) { return automaton.states.find(s => s.id === id); }

function groupedTransitions() {
  const map = new Map();
  for (const transition of automaton.transitions) {
    const key = `${transition.from}\u0000${transition.to}`;
    if (!map.has(key)) map.set(key, { from: transition.from, to: transition.to, symbols: [], ids: [] });
    const group = map.get(key);
    if (!group.symbols.includes(transition.symbol)) group.symbols.push(transition.symbol);
    group.ids.push(transition.id);
  }
  return [...map.values()];
}

function edgeGeometry(group) {
  const from = stateById(group.from), to = stateById(group.to);
  if (group.from === group.to) {
    const x = from.x, y = from.y;
    return { path: `M ${x - 18} ${y - 25} C ${x - 55} ${y - 88}, ${x + 55} ${y - 88}, ${x + 18} ${y - 25}`, lx: x, ly: y - 68 };
  }
  const dx = to.x - from.x, dy = to.y - from.y;
  const distance = Math.max(Math.hypot(dx, dy), 1);
  const ux = dx / distance, uy = dy / distance;
  const x1 = from.x + ux * 31, y1 = from.y + uy * 31;
  const x2 = to.x - ux * 35, y2 = to.y - uy * 35;
  const reverse = automaton.transitions.some(t => t.from === group.to && t.to === group.from);
  if (reverse) {
    const curve = Math.min(54, distance * .18);
    const cx = (x1 + x2) / 2 - uy * curve, cy = (y1 + y2) / 2 + ux * curve;
    return { path: `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`, lx: (x1 + 2 * cx + x2) / 4, ly: (y1 + 2 * cy + y2) / 4 - 7 };
  }
  return { path: `M ${x1} ${y1} L ${x2} ${y2}`, lx: (x1 + x2) / 2 - uy * 10, ly: (y1 + y2) / 2 + ux * 10 - 7 };
}

function render() {
  const edges = $("#edgesLayer"), nodes = $("#nodesLayer");
  edges.replaceChildren(); nodes.replaceChildren();
  for (const group of groupedTransitions()) {
    const geo = edgeGeometry(group);
    const selected = selection?.type === "transition" && group.ids.includes(selection.id);
    const hit = svgEl("path", { d: geo.path, class: "edge-hit", "data-transition": group.ids[0] });
    const path = svgEl("path", { d: geo.path, class: `edge${selected ? " selected" : ""}` });
    const label = svgEl("text", { x: geo.lx, y: geo.ly, class: "edge-label", "text-anchor": "middle" });
    label.textContent = group.symbols.join(", ");
    hit.addEventListener("click", event => { event.stopPropagation(); selectTransition(group.ids[0]); });
    edges.append(path, hit, label);
  }
  for (const state of automaton.states) {
    if (automaton.initial === state.id) {
      nodes.append(svgEl("path", { d: `M ${state.x - 72} ${state.y} L ${state.x - 34} ${state.y}`, class: "initial-arrow" }));
    }
    const classes = ["state"];
    if (selection?.type === "state" && selection.id === state.id) classes.push("selected");
    if (transitionOrigin === state.id) classes.push("pending");
    if (activeStates.has(state.id)) classes.push("active");
    const group = svgEl("g", { class: classes.join(" "), transform: `translate(${state.x} ${state.y})`, "data-state": state.id, tabindex: "0", role: "button", "aria-label": `Estado ${state.id}` });
    if (automaton.finals.includes(state.id)) group.append(svgEl("circle", { r: 29, class: "final" }));
    group.append(svgEl("circle", { r: 24, class: "main" }));
    const text = svgEl("text"); text.textContent = state.id; group.append(text);
    group.addEventListener("pointerdown", event => statePointerDown(event, state.id));
    group.addEventListener("keydown", event => { if (event.key === "Enter") stateAction(state.id); });
    nodes.append(group);
  }
  $("#emptyHint").hidden = automaton.states.length > 0;
  updateChecks(); updateSelectionEditor();
}

function statePointerDown(event, id) {
  event.stopPropagation();
  if (tool === "transition") { stateAction(id); return; }
  selection = { type: "state", id };
  if (tool !== "select") { render(); return; }
  const point = canvasPoint(event), state = stateById(id);
  dragSnapshot = snapshot();
  dragging = { id, dx: state.x - point.x, dy: state.y - point.y, moved: false, pointerId: event.pointerId };
  event.currentTarget.setPointerCapture(event.pointerId);
  render();
}

function stateAction(id) {
  if (!transitionOrigin) { transitionOrigin = id; selection = { type: "state", id }; render(); toast("Selecciona el estado de destino"); return; }
  pendingTransition = { from: transitionOrigin, to: id };
  $("#transitionTitle").textContent = `${transitionOrigin} → ${id}`;
  $("#transitionSymbol").value = "a";
  $("#transitionDialog").showModal();
  setTimeout(() => $("#transitionSymbol").select(), 0);
}

function selectTransition(id) { selection = { type: "transition", id }; transitionOrigin = null; render(); }

function setTool(next) {
  tool = next; transitionOrigin = null;
  $$(".tool").forEach(button => button.classList.toggle("active", button.dataset.tool === next));
  $("#canvasTip").textContent = next === "state" ? "Haz clic en el lienzo para agregar un estado" : next === "transition" ? "Elige el estado de origen y después el destino" : "Arrastra los estados para reorganizar el diagrama";
  render();
}

function nextStateName() {
  let n = 0;
  const used = new Set(automaton.states.map(s => s.id));
  while (used.has(`q${n}`)) n++;
  return `q${n}`;
}

function addState(point) {
  const previous = snapshot();
  const id = nextStateName();
  automaton.states.push({ id, x: Math.max(45, Math.min(855, point.x)), y: Math.max(45, Math.min(515, point.y)) });
  if (!automaton.initial) automaton.initial = id;
  selection = { type: "state", id };
  commit(previous); render();
}

function deleteSelection() {
  if (!selection) return toast("Selecciona un estado o una transición");
  const previous = snapshot();
  if (selection.type === "state") {
    const id = selection.id;
    automaton.states = automaton.states.filter(s => s.id !== id);
    automaton.transitions = automaton.transitions.filter(t => t.from !== id && t.to !== id);
    automaton.finals = automaton.finals.filter(x => x !== id);
    if (automaton.initial === id) automaton.initial = automaton.states[0]?.id || null;
  } else automaton.transitions = automaton.transitions.filter(t => t.id !== selection.id);
  selection = null; commit(previous); render();
}

function status(selector, title, text, kind = "info") {
  const el = $(selector); el.className = `status-card ${kind}`;
  el.innerHTML = `<strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p>`;
}
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[char])); }

function explainAst(ast, steps = []) {
  if (ast.type === "lit") steps.push({ title: `Caso básico: ${ast.value}`, detail: `Se conectan dos estados con una transición etiquetada ${ast.value}.` });
  else if (ast.type === "eps") steps.push({ title: "Caso básico: λ", detail: "La transición vacía permite avanzar sin consumir símbolos." });
  else if (ast.type === "empty") steps.push({ title: "Caso básico: ∅", detail: "Se crean estados sin camino entre el inicial y el final." });
  else if (ast.type === "union") { ast.items.forEach(x => explainAst(x, steps)); steps.push({ title: "Aplicar unión", detail: "Se añade un nuevo estado inicial con transiciones λ hacia cada alternativa. Los finales de las alternativas se conservan." }); }
  else if (ast.type === "concat") { ast.items.forEach(x => explainAst(x, steps)); steps.push({ title: "Aplicar concatenación", detail: "El final de cada componente se conecta por λ con el inicio del siguiente." }); }
  else if (ast.type === "star") {
    explainAst(ast.item, steps);
    const symbols = ast.item.type === "lit" ? [ast.item.value] : ast.item.type === "union" && ast.item.items.every(item => item.type === "lit") ? ast.item.items.map(item => item.value) : null;
    steps.push({ title: "Aplicar estrella de Kleene", detail: symbols ? `Se usa la forma simplificada: un único estado inicial/final con ${symbols.length === 1 ? "el lazo" : "los lazos"} ${symbols.join(", ")}.` : "El estado inicial también se marca como final y cada final vuelve al inicio mediante λ." });
  }
  return steps;
}

function showResult({ title, label, value, equations = [], steps = [] }) {
  $("#resultTitle").textContent = title;
  $("#resultEmpty").hidden = true; $("#resultContent").hidden = false;
  $("#resultLabel").textContent = label; $("#finalResult").textContent = value;
  const eqBlock = $("#equationsBlock"); eqBlock.hidden = !equations.length;
  $("#equationsList").replaceChildren(...equations.map(eq => { const el = document.createElement("code"); el.textContent = eq; return el; }));
  $("#stepsList").replaceChildren(...steps.map(step => {
    const li = document.createElement("li"), b = document.createElement("b"), p = document.createElement("p");
    b.textContent = step.title; p.textContent = step.detail; li.append(b, p); return li;
  }));
}

function buildRegex() {
  try {
    const input = $("#regexInput").value;
    const previous = snapshot();
    const result = regexToNFA(input);
    automaton = result.automaton; selection = null; activeStates.clear(); commit(previous); render();
    status("#regexStatus", "Construcción completada", `${automaton.states.length} estados y ${automaton.transitions.length} transiciones.`, "success");
    showResult({ title: "Construcción paso a paso", label: "Expresión normalizada", value: result.normalized, steps: explainAst(result.ast) });
  } catch (error) { status("#regexStatus", "Revisa la expresión", error.message, "error"); toast(error.message); }
}

function solveAutomaton() {
  try {
    const result = automatonToRegex(automaton);
    const note = result.hadEpsilon ? " Se eliminaron primero las transiciones λ." : "";
    status("#ardenStatus", "Expresión obtenida", `Se resolvieron ${result.equations.length} ecuaciones.${note}`, "success");
    const steps = result.hadEpsilon ? [{ title: "Eliminar transiciones λ", detail: "Se calcularon las λ-clausuras para obtener un AFN equivalente sin transiciones vacías." }, ...result.steps] : result.steps;
    showResult({ title: "Resolución con el lema de Arden", label: "Expresión regular equivalente", value: result.regex, equations: result.equations, steps });
  } catch (error) { status("#ardenStatus", "No se puede resolver", error.message, "error"); toast(error.message); }
}

function updateChecks() {
  const data = [[$("#checkStates"), automaton.states.length > 0], [$("#checkInitial"), Boolean(automaton.initial)], [$("#checkFinal"), automaton.finals.length > 0]];
  for (const [element, ok] of data) { element.textContent = ok ? "✓" : "○"; element.classList.toggle("ok", ok); }
}

function updateSelectionEditor() {
  const editor = $("#selectionEditor");
  const state = selection?.type === "state" ? stateById(selection.id) : null;
  editor.hidden = !state;
  if (state && document.activeElement !== $("#stateName")) $("#stateName").value = state.id;
}

function setInitial() {
  if (selection?.type !== "state") return toast("Selecciona un estado");
  const previous = snapshot(); automaton.initial = selection.id; commit(previous); render();
}
function toggleFinal() {
  if (selection?.type !== "state") return toast("Selecciona un estado");
  const previous = snapshot(), id = selection.id;
  automaton.finals = automaton.finals.includes(id) ? automaton.finals.filter(x => x !== id) : [...automaton.finals, id];
  commit(previous); render();
}
function renameState() {
  if (selection?.type !== "state") return;
  const current = selection.id, next = $("#stateName").value.trim();
  if (!next) return toast("El nombre no puede estar vacío");
  if (next !== current && stateById(next)) return toast("Ya existe un estado con ese nombre");
  const previous = snapshot(); stateById(current).id = next;
  for (const t of automaton.transitions) { if (t.from === current) t.from = next; if (t.to === current) t.to = next; }
  if (automaton.initial === current) automaton.initial = next;
  automaton.finals = automaton.finals.map(x => x === current ? next : x);
  selection.id = next; commit(previous); render();
}

function runSimulation() {
  try {
    const result = simulate(automaton, $("#wordInput").value);
    const final = result.path.at(-1).states;
    activeStates = new Set(final); render();
    const box = $("#simulationResult"); box.className = `simulation-result ${result.accepted ? "accepted" : "rejected"}`;
    box.innerHTML = `<span>●</span><p><b>Cadena ${result.accepted ? "aceptada" : "rechazada"}</b><small>${escapeHtml(result.path.map(x => `{${x.states.join(", ") || EMPTY}}`).join(" → "))}</small></p>`;
  } catch (error) { toast(error.message); }
}

function download(filename, content, type) {
  const blob = new Blob([content], { type }), url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

function exportSvg() {
  const clone = $("#automatonCanvas").cloneNode(true);
  clone.setAttribute("xmlns", svgNS); clone.querySelectorAll(".edge-hit").forEach(x => x.remove());
  const style = document.createElementNS(svgNS, "style");
  style.textContent = `.edge{fill:none;stroke:#657189;stroke-width:2;marker-end:url(#arrow)}.edge-label{fill:#344057;font:700 14px serif;paint-order:stroke;stroke:white;stroke-width:5px}.state circle.main{fill:white;stroke:#344057;stroke-width:2.3}.state circle.final{fill:none;stroke:#344057;stroke-width:2}.state text{text-anchor:middle;dominant-baseline:middle;font:700 13px sans-serif}.initial-arrow{fill:none;stroke:#344057;stroke-width:2;marker-end:url(#arrow)}`;
  clone.prepend(style); download("automata-kleene.svg", new XMLSerializer().serializeToString(clone), "image/svg+xml"); toast("Diagrama SVG exportado");
}

function loadAutomaton(data, message = "Proyecto cargado") {
  validateAutomaton(data);
  const previous = snapshot(); automaton = cloneAutomaton(data); selection = null; activeStates.clear(); commit(previous); render(); toast(message);
}

function bindEvents() {
  $$(".direction").forEach(button => button.addEventListener("click", () => {
    $$(".direction").forEach(x => x.classList.toggle("active", x === button));
    $$(".view-panel").forEach(x => x.classList.remove("active"));
    $(`#${button.dataset.view}Panel`).classList.add("active");
  }));
  $$(".tool").forEach(button => button.addEventListener("click", () => setTool(button.dataset.tool)));
  $("#automatonCanvas").addEventListener("pointerdown", event => {
    if (event.target.closest?.("[data-state], .edge-hit")) return;
    selection = null; transitionOrigin = null;
    if (tool === "state") addState(canvasPoint(event)); else render();
  });
  window.addEventListener("pointermove", event => {
    if (!dragging) return;
    const point = canvasPoint(event), state = stateById(dragging.id);
    state.x = Math.max(35, Math.min(865, point.x + dragging.dx));
    state.y = Math.max(35, Math.min(525, point.y + dragging.dy));
    dragging.moved = true; render();
  });
  window.addEventListener("pointerup", () => {
    if (dragging?.moved) commit(dragSnapshot);
    dragging = null; dragSnapshot = null;
  });
  $("#buildRegex").addEventListener("click", buildRegex);
  $("#regexInput").addEventListener("keydown", event => { if (event.key === "Enter") buildRegex(); });
  $("#insertUnion").addEventListener("click", () => { const input=$("#regexInput"), p=input.selectionStart; input.setRangeText("∪",p,input.selectionEnd,"end"); input.focus(); });
  $$("[data-regex]").forEach(button => button.addEventListener("click", () => { $("#regexInput").value = button.dataset.regex; buildRegex(); }));
  $("#solveAutomaton").addEventListener("click", solveAutomaton);
  $("#loadClassExample").addEventListener("click", () => loadAutomaton(exampleAutomaton(), "Ejemplo de clase cargado"));
  $("#setInitial").addEventListener("click", setInitial); $("#toggleFinal").addEventListener("click", toggleFinal);
  $("#deleteSelection").addEventListener("click", deleteSelection); $("#renameState").addEventListener("click", renameState);
  $("#stateName").addEventListener("keydown", event => { if (event.key === "Enter") renameState(); });
  $("#autoLayout").addEventListener("click", () => { if (!automaton.states.length) return; const previous=snapshot(); autoLayout(automaton); commit(previous); render(); });
  $("#undoButton").addEventListener("click", undo); $("#redoButton").addEventListener("click", redo);
  $("#newAutomaton").addEventListener("click", () => { const previous=snapshot(); automaton={states:[],transitions:[],initial:null,finals:[]}; selection=null;commit(previous);render();closeMore(); });
  $("#moreButton").addEventListener("click", () => { const menu=$("#moreMenu"); menu.hidden=!menu.hidden; $("#moreButton").setAttribute("aria-expanded", String(!menu.hidden)); });
  document.addEventListener("click", event => { if (!event.target.closest("#moreButton, #moreMenu")) closeMore(); });
  $("#exportSvg").addEventListener("click", () => { exportSvg(); closeMore(); });
  $("#exportJson").addEventListener("click", () => { download("proyecto-kleene.json", JSON.stringify(automaton,null,2), "application/json"); closeMore(); });
  $("#importJson").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", async event => { try { loadAutomaton(JSON.parse(await event.target.files[0].text())); } catch(error) { toast(`Archivo inválido: ${error.message}`); } event.target.value="";closeMore(); });
  $("#simulateButton").addEventListener("click", runSimulation); $("#wordInput").addEventListener("keydown", event => { if(event.key==="Enter") runSimulation(); });
  $("#helpButton").addEventListener("click", () => $("#helpDialog").showModal());
  $("#copyResult").addEventListener("click", async () => { const value=$("#finalResult").textContent; if(!value)return toast("Aún no hay resultado"); await navigator.clipboard.writeText(value);toast("Resultado copiado"); });
  $$("[data-symbol]").forEach(button => button.addEventListener("click", () => { $("#transitionSymbol").value=button.dataset.symbol;$("#transitionSymbol").focus(); }));
  $("#transitionDialog").addEventListener("close", () => { if ($("#transitionDialog").returnValue === "default" && pendingTransition) createTransition(); else { pendingTransition=null; transitionOrigin=null; render(); } });
  $("#transitionSymbol").addEventListener("keydown", event => { if(event.key==="Enter") { event.preventDefault(); $("#confirmTransition").click(); } });
  window.addEventListener("keydown", event => {
    if (["INPUT","TEXTAREA"].includes(document.activeElement.tagName) || $("#transitionDialog").open) return;
    if (event.key === "Delete") deleteSelection();
    if (event.key.toLowerCase() === "v") setTool("select");
    if (event.key.toLowerCase() === "e") setTool("state");
    if (event.key.toLowerCase() === "t") setTool("transition");
    if (event.ctrlKey && event.key.toLowerCase() === "z") { event.preventDefault(); undo(); }
    if (event.ctrlKey && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
  });
}

function createTransition() {
  const symbol = $("#transitionSymbol").value.trim();
  if (!symbol) { pendingTransition=null;transitionOrigin=null;render();return toast("La transición necesita un símbolo"); }
  const previous = snapshot();
  automaton.transitions.push({ id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2,5)}`, ...pendingTransition, symbol: symbol === "ε" ? EPSILON : symbol });
  pendingTransition = null; transitionOrigin = null; commit(previous); render();
}
function closeMore() { $("#moreMenu").hidden=true;$("#moreButton").setAttribute("aria-expanded","false"); }

bindEvents();
updateHistoryButtons();
render();
buildRegex();
