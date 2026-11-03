import type { ApprovalDiffLine } from "@workspace/api-client-react";

export interface SideBySideRow {
  oldNo: number | null;
  newNo: number | null;
  oldText: string | null;
  newText: string | null;
  type: "context" | "add" | "del" | "change";
}

export function toSideBySide(lines: ApprovalDiffLine[]): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.type === "context") {
      oldNo++;
      newNo++;
      rows.push({ oldNo, newNo, oldText: l.text, newText: l.text, type: "context" });
      i++;
      continue;
    }
    const dels: string[] = [];
    const adds: string[] = [];
    while (i < lines.length && lines[i].type === "del") {
      dels.push(lines[i].text);
      i++;
    }
    while (i < lines.length && lines[i].type === "add") {
      adds.push(lines[i].text);
      i++;
    }
    const max = Math.max(dels.length, adds.length);
    for (let k = 0; k < max; k++) {
      const dText = k < dels.length ? dels[k] : null;
      const aText = k < adds.length ? adds[k] : null;
      const oldRowNo = dText !== null ? ++oldNo : null;
      const newRowNo = aText !== null ? ++newNo : null;
      const type: SideBySideRow["type"] =
        dText !== null && aText !== null ? "change" : dText !== null ? "del" : "add";
      rows.push({ oldNo: oldRowNo, newNo: newRowNo, oldText: dText, newText: aText, type });
    }
  }
  return rows;
}
