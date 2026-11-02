import type { StaticObject, StaticValue } from "./types.ts";

// The Babel nodes read here, loosely typed: magicast brings the parser, its types aren't needed.
interface Node {
  type: string;
  start?: number | null;
  end?: number | null;
  [key: string]: unknown;
}

const DYNAMIC_SOURCE_MAX = 200;

/**
 * The default export of a config file (`export default defineX({…})`, `module.exports = …`), its
 * literal parts only: the file is parsed, never run. Undefined when it can't be parsed or exports
 * nothing. magicast (Babel) is loaded on the first call.
 *
 * @example
 * await readConfig('export default defineNuxtConfig({ dir: { public: "static" } })');
 * // → { dir: { public: "static" } }
 */
export async function readConfig(code: string): Promise<StaticValue | undefined> {
  const { parseModule } = await import("magicast/core");
  let program: Node;
  try {
    program = parseModule(code).$ast as unknown as Node;
  } catch {
    return undefined;
  }
  const body = (program.body as Node[]) ?? [];
  const constants = new Map<string, Node>();
  for (const statement of body) {
    const declaration =
      statement.type === "ExportNamedDeclaration" ? (statement.declaration as Node) : statement;
    if (declaration?.type !== "VariableDeclaration") continue;
    for (const declarator of declaration.declarations as Node[]) {
      const id = declarator.id as Node;
      if (id.type === "Identifier" && declarator.init) {
        constants.set(id.name as string, declarator.init as Node);
      }
    }
  }
  const exported = defaultExport(body);
  return exported ? toValue(exported, code, constants, new Set()) : undefined;
}

function defaultExport(body: Node[]): Node | undefined {
  for (const statement of body) {
    if (statement.type === "ExportDefaultDeclaration") return statement.declaration as Node;
    // module.exports = …
    if (statement.type === "ExpressionStatement") {
      const expression = statement.expression as Node;
      if (expression.type !== "AssignmentExpression") continue;
      const left = expression.left as Node;
      if (
        left.type === "MemberExpression" &&
        (left.object as Node).type === "Identifier" &&
        (left.object as Node).name === "module" &&
        (left.property as Node).name === "exports"
      ) {
        return expression.right as Node;
      }
    }
  }
  return undefined;
}

function dynamic(node: Node, code: string): StaticValue {
  const source =
    node.start != null && node.end != null ? code.slice(node.start, node.end) : node.type;
  return {
    $dynamic:
      source.length > DYNAMIC_SOURCE_MAX ? `${source.slice(0, DYNAMIC_SOURCE_MAX)}…` : source,
  };
}

const WRAPPERS = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "ParenthesizedExpression",
]);

function toValue(
  node: Node,
  code: string,
  constants: Map<string, Node>,
  resolving: Set<string>,
): StaticValue {
  const value = (child: Node) => toValue(child, code, constants, resolving);
  if (WRAPPERS.has(node.type)) return value(node.expression as Node);
  switch (node.type) {
    case "StringLiteral":
      return node.value as string;
    case "NumericLiteral":
      return node.value as number;
    case "BooleanLiteral":
      return node.value as boolean;
    case "NullLiteral":
      return null;
    case "TemplateLiteral": {
      if ((node.expressions as Node[]).length) return dynamic(node, code);
      const quasi = (node.quasis as Node[])[0];
      return quasi ? (quasi.value as { cooked: string }).cooked : "";
    }
    case "UnaryExpression": {
      const argument = node.argument as Node;
      if (node.operator === "-" && argument.type === "NumericLiteral") {
        return -(argument.value as number);
      }
      return dynamic(node, code);
    }
    case "ArrayExpression":
      return (node.elements as (Node | null)[]).map((element) =>
        !element
          ? null
          : element.type === "SpreadElement"
            ? dynamic(element, code)
            : value(element),
      );
    case "ObjectExpression": {
      const object: StaticObject = {};
      for (const property of node.properties as Node[]) {
        if (property.type !== "ObjectProperty" || property.computed) continue;
        const key = property.key as Node;
        const name =
          key.type === "Identifier"
            ? (key.name as string)
            : key.type === "StringLiteral" || key.type === "NumericLiteral"
              ? String(key.value)
              : undefined;
        if (name !== undefined) object[name] = value(property.value as Node);
      }
      return object;
    }
    case "CallExpression": {
      // defineNuxtConfig({…}), defineCollection({…}): their argument is the value.
      const callee = node.callee as Node;
      const args = node.arguments as Node[];
      if (callee.type === "Identifier" && /^define[A-Z]/.test(callee.name as string) && args[0]) {
        return value(args[0]);
      }
      return dynamic(node, code);
    }
    case "Identifier": {
      const name = node.name as string;
      if (name === "undefined") return dynamic(node, code);
      const init = constants.get(name);
      if (!init || resolving.has(name)) return dynamic(node, code);
      resolving.add(name);
      try {
        return value(init);
      } finally {
        resolving.delete(name);
      }
    }
    default:
      return dynamic(node, code);
  }
}

/** `value` is an object read statically, not an array nor a dynamic part. */
export function isObject(value: StaticValue | undefined): value is StaticObject {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) && !("$dynamic" in value)
  );
}

/** `value` as a string, when it is one. */
export function asString(value: StaticValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}
