/**
 * Serialize a `JmxTree` IR to a single XML string suitable for the
 * JMeter GUI to open. JMeter requires that every element which has
 * tree children be followed by a sibling `<hashTree>...</hashTree>`
 * containing those children, and that elements with no children get
 * `<hashTree/>`. The serializer is the only place that knows this —
 * the IR is "logical" tree-shape only.
 */
import type { IrNode, JmxTree } from "@/features/jmx/infrastructure/jmxIr";
import { xmlEscape } from "@/features/jmx/infrastructure/jmxIr";

const XML_HEAD =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">\n`;

function renderAttrs(attrs: Record<string, string> | undefined): string {
  if (!attrs) return "";
  const keys = Object.keys(attrs);
  if (keys.length === 0) return "";
  return (
    " " +
    keys.map((k) => `${k}="${xmlEscape(attrs[k]!)}"`).join(" ")
  );
}

function renderPair(node: IrNode): string {
  const attrs = renderAttrs(node.attrs);
  const body = node.body ?? "";
  const open = `<${node.tag}${attrs}>${body}</${node.tag}>`;
  const children = node.children ?? [];
  if (children.length === 0) {
    return `${open}\n<hashTree/>\n`;
  }
  const inner = children.map(renderPair).join("");
  return `${open}\n<hashTree>\n${inner}</hashTree>\n`;
}

export function serializeJmxTree(tree: JmxTree): string {
  return (
    XML_HEAD +
    `<hashTree>\n${renderPair(tree.testPlan)}</hashTree>\n` +
    `</jmeterTestPlan>\n`
  );
}
