/**
 * OUTLANDS-1d - blaxxun VrmlScript "uninitialized function-local" compatibility.
 *
 * WHAT THIS SOLVES. blaxxun Contact's VrmlScript interpreter is not ECMAScript.
 * Its own vendor documentation (blaxxun Contact 3D Authoring Guide,
 * `3dscripting5.html`, "blaxxun Contact vrmlscript limitations compared to ECMA
 * Script") states:
 *
 *   "Undeclared variables are local to a function (like in C or Java); global
 *    variables are only those declared in the script interface as field,
 *    exposedField or eventOut."
 *
 * and `3dscripting3.html` lists "use of uninitialized variables" as a *verbose
 * warning*, not an error. The shipped `blaxxuncc3d.ocx` error table confirms it:
 * it carries messages for bad arity and for member assignment, but none at all
 * for reading an unknown name.
 *
 * So under Contact, reading a name the author never declared yielded
 * `undefined` and the script kept running. X_ITE 4.7.0 evaluates script source
 * as `with (global) { eval (text) }` (`Browser/Scripting/evaluate.js`), where a
 * free *read* throws `ReferenceError` and kills the handler.
 *
 * WHAT THE HISTORICAL DEFECT LOOKS LIKE. The author omitted a parameter list.
 * In `ne_game.wrl` twenty-four handlers are written `function set_position(v,t)`
 * - the VRML97 ECMAScript binding's (value, timestamp) pair - but three are
 * written `function set_team()` and then read `v` or `t` anyway. The name is
 * proven to be an event-handler variable *by the script's own other functions*.
 * That is the signal this module keys on, and it is why a real typo is not
 * caught by it: a typo is not a parameter name anywhere in the same script.
 *
 * WHAT THIS IS NOT. There is no world name here, no function name, no Outlands
 * knowledge of any kind. The rule is a property of blaxxun's language, so it is
 * expressed as a property of the source text. Nothing rewrites a `.wrl` file.
 *
 * SCOPE OF THE FIX. `blaxxunUninitializedLocals()` returns the names that
 * qualify; the X_ITE binding in `libs/x_ite_mods/bxx_script.js` defines those,
 * and only those, on that one Script node's sandbox object with the value
 * `undefined`. A declared parameter is a function-scope binding and therefore
 * always shadows a `with`-object binding, so the twenty-four working handlers
 * keep receiving the real event value and timestamp.
 */

/**
 * Reserved words and the literals X_ITE itself installs. A candidate that
 * collides with any of these is never bound - the sandbox already owns the
 * name, or the language does.
 */
const NEVER_BIND = new Set<string>([
  // ECMAScript reserved words and literals.
  "arguments", "await", "break", "case", "catch", "class", "const", "continue",
  "debugger", "default", "delete", "do", "else", "enum", "eval", "export",
  "extends", "false", "finally", "for", "function", "if", "implements",
  "import", "in", "instanceof", "interface", "let", "new", "null", "package",
  "private", "protected", "public", "return", "static", "super", "switch",
  "this", "throw", "true", "try", "typeof", "undefined", "var", "void",
  "while", "with", "yield",
  // The four callbacks X_ITE appends a `var` declaration for in `getContext`.
  // Binding one of these on the sandbox would intercept its own extraction
  // trick and hand back a null callback.
  "initialize", "prepareEvents", "eventsProcessed", "shutdown",
  // Names X_ITE puts in every script sandbox.
  "NULL", "FALSE", "TRUE", "print", "trace", "Browser",
]);

/** Matches an ECMAScript identifier as VrmlScript ever used one. */
const IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]*/g;

/**
 * Blanks comments and string literals, keeping the source length so every
 * offset computed on the mask is still valid on the original.
 */
export function maskLiterals(source: string): string {
  const out = source.split("");
  let i = 0;

  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < out.length; k += 1) {
      if (out[k] !== "\n") out[k] = " ";
    }
  };

  while (i < source.length) {
    const two = source.substr(i, 2);

    if (two === "//") {
      let end = source.indexOf("\n", i);
      if (end === -1) end = source.length;
      blank(i, end);
      i = end;
      continue;
    }

    if (two === "/*") {
      let end = source.indexOf("*/", i + 2);
      end = end === -1 ? source.length : end + 2;
      blank(i, end);
      i = end;
      continue;
    }

    const quote = source[i];
    if (quote === "\"" || quote === "'") {
      let k = i + 1;
      while (k < source.length) {
        if (source[k] === "\\") { k += 2; continue; }
        if (source[k] === quote || source[k] === "\n") break;
        k += 1;
      }
      blank(i, Math.min(k + 1, source.length));
      i = Math.min(k + 1, source.length);
      continue;
    }

    i += 1;
  }

  return out.join("");
}

interface FunctionScope {
  /** First index of the body, just after `{`. */
  bodyStart: number;
  /** Index just after the matching `}`. */
  bodyEnd: number;
  /** Declared parameter names. */
  params: string[];
  /** Enclosing scope, or `null` at the top level. */
  parent: FunctionScope | null;
  /** `var` names declared directly in this function. */
  vars: Set<string>;
}

/** Returns the index just past the `}` that closes the `{` at `open`. */
function matchBrace(masked: string, open: number): number {
  let depth = 0;
  for (let i = open; i < masked.length; i += 1) {
    if (masked[i] === "{") depth += 1;
    else if (masked[i] === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return masked.length;
}

/** Collects every function in the masked source, innermost scopes linked up. */
function collectFunctions(masked: string): FunctionScope[] {
  const pattern = /\bfunction\b\s*([A-Za-z_$][A-Za-z0-9_$]*)?\s*\(([^)]*)\)\s*\{/g;
  const found: FunctionScope[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(masked)) !== null) {
    const open = masked.indexOf("{", match.index + match[0].length - 1);
    const params = match[2]
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0);

    found.push({
      bodyStart: open + 1,
      bodyEnd: matchBrace(masked, open),
      params,
      parent: null,
      vars: new Set<string>(),
    });
  }

  // A function whose body contains another's start is that other's parent; the
  // innermost such container wins.
  for (const scope of found) {
    let parent: FunctionScope | null = null;
    for (const candidate of found) {
      if (candidate === scope) continue;
      const contains = candidate.bodyStart <= scope.bodyStart
        && candidate.bodyEnd >= scope.bodyEnd;
      if (!contains) continue;
      if (parent === null || candidate.bodyStart > parent.bodyStart) parent = candidate;
    }
    scope.parent = parent;
  }

  return found;
}

/** The parts of `[from, to)` that no listed function body covers. */
function ownRegions(
  masked: string,
  from: number,
  to: number,
  children: FunctionScope[],
): string[] {
  const holes = children
    .map((child) => ({ start: child.bodyStart, end: child.bodyEnd }))
    .sort((a, b) => a.start - b.start);

  const parts: string[] = [];
  let cursor = from;
  for (const hole of holes) {
    if (hole.start > cursor) parts.push(masked.slice(cursor, hole.start));
    cursor = Math.max(cursor, hole.end);
  }
  if (cursor < to) parts.push(masked.slice(cursor, to));
  return parts;
}

/** `var a, b = 1;` declarations directly inside the given text. */
function declaredVars(text: string): Set<string> {
  const names = new Set<string>();
  const pattern = /\bvar\b([^;{}]*)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    for (const clause of match[1].split(",")) {
      const name = clause.split("=")[0].trim();
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) names.add(name);
    }
  }
  return names;
}

/**
 * Names assigned in the given text: `a = 1`, `a += 1`, `a++`, `--a`. `==`,
 * `===`, `!=`, `>=` and `<=` are comparisons and are not assignments.
 */
function assignedNames(text: string): Set<string> {
  const names = new Set<string>();

  const simple = /(^|[^A-Za-z0-9_$.])([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:[+\-*/%|&^]|<<|>>)?=(?!=)/g;
  let match: RegExpExecArray | null;
  while ((match = simple.exec(text)) !== null) {
    if (text[match.index + match[0].length - 2] === "!") continue;
    if (text[match.index + match[0].length - 2] === "<") continue;
    if (text[match.index + match[0].length - 2] === ">") continue;
    names.add(match[2]);
  }

  const step = new RegExp(
    "(^|[^A-Za-z0-9_$.])([A-Za-z_$][A-Za-z0-9_$]*)\\s*(\\+\\+|--)"
    + "|(\\+\\+|--)\\s*([A-Za-z_$][A-Za-z0-9_$]*)",
    "g",
  );
  while ((match = step.exec(text)) !== null) {
    names.add(match[2] || match[5]);
  }

  return names;
}

/**
 * Names *read* in the given text. A name after a `.` is a property, and a name
 * before a `:` inside braces is an object-literal key; neither resolves through
 * the scope chain, so neither counts.
 */
function readNames(text: string): Set<string> {
  const names = new Set<string>();
  IDENTIFIER.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = IDENTIFIER.exec(text)) !== null) {
    const before = text.slice(0, match.index).replace(/\s+$/, "");
    if (before.endsWith(".")) continue;

    const after = text.slice(match.index + match[0].length).replace(/^\s+/, "");
    if (after.startsWith(":") && !after.startsWith("::")) continue;

    names.add(match[0]);
  }
  return names;
}

/** Every name visible to `scope` through parameters and `var` declarations. */
function inScope(scope: FunctionScope, name: string): boolean {
  for (let s: FunctionScope | null = scope; s !== null; s = s.parent) {
    if (s.params.indexOf(name) !== -1) return true;
    if (s.vars.has(name)) return true;
  }
  return false;
}

/**
 * The names a blaxxun Contact script read as uninitialized function-locals, and
 * that X_ITE 4.7.0 would instead reject with `ReferenceError`.
 *
 * A name qualifies only when ALL of these hold:
 *
 *   1. some function reads it with nothing in its scope chain to resolve it,
 *      and it is not a top-level `function` or `var` name;
 *   2. some function in the SAME script declares it as a parameter. This is the
 *      evidence that the author meant an event-handler variable and omitted the
 *      parameter list - a genuine typo has no such twin, so it still throws;
 *   3. it is never freely *assigned* anywhere in the script. X_ITE's sloppy-mode
 *      `m = Browser.eventMask` already works by creating a real global, and
 *      this rule leaves that behaviour exactly as it was;
 *   4. it is not a reserved word, an X_ITE sandbox name, or one of the four
 *      callbacks X_ITE extracts by appending its own `var` declaration.
 *
 * The caller applies a fifth check that needs the live node: a name already
 * present on the sandbox - a `field`, `exposedField` or `eventOut` - is left
 * alone.
 */
export function blaxxunUninitializedLocals(source: string): string[] {
  const masked = maskLiterals(source);
  const functions = collectFunctions(masked);

  for (const scope of functions) {
    const children = functions.filter((f) => f.parent === scope);
    const own = ownRegions(masked, scope.bodyStart, scope.bodyEnd, children).join("\n");
    scope.vars = declaredVars(own);
  }

  const topLevel = functions.filter((f) => f.parent === null);
  const topRegion = ownRegions(masked, 0, masked.length, topLevel).join("\n");

  const topNames = declaredVars(topRegion);
  const declaration = /\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  let named: RegExpExecArray | null;
  while ((named = declaration.exec(masked)) !== null) topNames.add(named[1]);

  const parameters = new Set<string>();
  for (const scope of functions) {
    for (const param of scope.params) parameters.add(param);
  }

  // Free assignments, anywhere. A write inside a function that declares the
  // name - `receive_aapd(v,t)` doing `v = new SFVec3f(...)` - is a write to its
  // own parameter and says nothing about the free name.
  const freelyAssigned = new Set<string>();
  const addFreeAssignments = (text: string, scope: FunctionScope | null): void => {
    for (const name of assignedNames(text)) {
      if (scope !== null && inScope(scope, name)) continue;
      if (topNames.has(name)) continue;
      freelyAssigned.add(name);
    }
  };

  addFreeAssignments(topRegion, null);
  for (const scope of functions) {
    const children = functions.filter((f) => f.parent === scope);
    const own = ownRegions(masked, scope.bodyStart, scope.bodyEnd, children).join("\n");
    addFreeAssignments(own, scope);
  }

  const qualified = new Set<string>();
  for (const scope of functions) {
    const children = functions.filter((f) => f.parent === scope);
    const own = ownRegions(masked, scope.bodyStart, scope.bodyEnd, children).join("\n");

    for (const name of readNames(own)) {
      if (NEVER_BIND.has(name)) continue;
      if (topNames.has(name)) continue;
      if (inScope(scope, name)) continue;
      if (!parameters.has(name)) continue;
      if (freelyAssigned.has(name)) continue;
      qualified.add(name);
    }
  }

  return Array.from(qualified).sort();
}
