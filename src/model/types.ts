/** 三層選取的 stable id：glyph:<cp> / component:<cp>:<path> / stroke:<cp>:<index>（不用陣列索引當 id） */

export type Selection =
  | { kind: "glyph"; cp: number }
  | { kind: "component"; cp: number; path: number[] }
  | { kind: "stroke"; cp: number; index: number };

export function selectionId(sel: Selection): string {
  switch (sel.kind) {
    case "glyph":
      return `glyph:${sel.cp}`;
    case "component":
      return `component:${sel.cp}:${sel.path.join(".")}`;
    case "stroke":
      return `stroke:${sel.cp}:${sel.index}`;
  }
}
