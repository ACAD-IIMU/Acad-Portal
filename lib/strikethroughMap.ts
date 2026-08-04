import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

// Duplicated from parseTimetable.ts rather than imported, to avoid a circular
// import (parseTimetable.ts already imports buildStrikethroughMap from this
// file). Keep these two in sync if the matching logic ever changes.
function normalizeSheetName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface StrikeRun {
  text: string;
  struck: boolean;
}

export interface CellStrikeInfo {
  fullyStruck: boolean;
  runs?: StrikeRun[]; // present only when the cell has multiple rich-text runs
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

function asArray<T>(x: T | T[] | undefined): T[] {
  if (x === undefined) return [];
  return Array.isArray(x) ? x : [x];
}

function parseRichTextNode(node: any): { text: string; runs?: StrikeRun[] } {
  if (node?.r) {
    const runs: StrikeRun[] = asArray(node.r).map((r: any) => {
      const text = typeof r.t === "object" ? r.t?.["#text"] ?? "" : r.t ?? "";
      let struck = false;
      if (r.rPr && r.rPr.strike !== undefined) {
        const val = r.rPr.strike && r.rPr.strike["@_val"];
        // A bare <strike/> (no val attribute) means true; val="0"/"false" means explicitly off.
        struck = val === undefined ? true : !(val === "0" || val === "false");
      }
      return { text, struck };
    });
    return { text: runs.map((r) => r.text).join(""), runs };
  }
  const text = typeof node?.t === "object" ? node.t?.["#text"] ?? "" : node?.t ?? "";
  return { text };
}

/**
 * Reads strikethrough info directly from the file's underlying XML, bypassing both `xlsx`
 * (which cannot read any cell styling at all) and `exceljs` (which was tested and found to
 * incorrectly report an entire cell as struck when only one of several rich-text runs in it
 * actually is — confirmed against a hand-built test file with mixed strikethrough before this
 * module was written). Handles both possible cell text formats: inline strings (`t="inlineStr"`)
 * and the shared-strings table (`t="s"`, common when a file has been through Excel/LibreOffice).
 */
export async function buildStrikethroughMap(buffer: Buffer, targetTerm: string): Promise<Map<string, CellStrikeInfo>> {
  const zip = await JSZip.loadAsync(buffer);

  const workbookXml = await zip.file("xl/workbook.xml")!.async("string");
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
  const workbookDoc = parser.parse(workbookXml);
  const relsDoc = parser.parse(relsXml);

  // Resolve the sheet by NAME matching targetTerm — not sheets[0]. This used to read
  // position 0 on the assumption that always matched wb.SheetNames[0] used for the grid
  // (see parseTimetable.ts); that assumption broke the moment a new tab got added ahead
  // of the real current-term tab, silently pulling strikethrough data from the wrong
  // sheet entirely while the grid itself read the correct one — so real cancellations
  // stopped being detected with no visible error.
  const sheets = asArray(workbookDoc.workbook.sheets.sheet);
  const normalizedTarget = normalizeSheetName(targetTerm);
  const matchedSheet = sheets.find((s: any) => normalizeSheetName(String(s["@_name"])) === normalizedTarget);
  if (!matchedSheet) {
    throw new Error(
      `No sheet matching term "${targetTerm}" found for strikethrough detection. Available: ${sheets.map((s: any) => s["@_name"]).join(", ")}`
    );
  }
  const targetRid = matchedSheet["@_r:id"];
  const rels = asArray(relsDoc.Relationships.Relationship);
  const rel = rels.find((r: any) => r["@_Id"] === targetRid);
  const target = rel["@_Target"].replace(/^\/?xl\//, "");
  const sheetPath = `xl/${target}`;

  const sheetXml = await zip.file(sheetPath)!.async("string");
  const stylesXml = await zip.file("xl/styles.xml")!.async("string");
  const sheetDoc = parser.parse(sheetXml);
  const stylesDoc = parser.parse(stylesXml);

  // fontId -> whether that font is strikethrough
  const fonts = asArray(stylesDoc.styleSheet.fonts.font);
  const fontStrikes = fonts.map((f: any) => !!(f && f.strike !== undefined));

  // cellXfs style index -> fontId (used for whole-cell, non-rich-text strikethrough)
  const xfs = asArray(stylesDoc.styleSheet.cellXfs.xf);
  const xfFontIds = xfs.map((xf: any) => parseInt(xf["@_fontId"] ?? "0", 10));

  function styleIndexStruck(styleIdx: number): boolean {
    const fontId = xfFontIds[styleIdx] ?? 0;
    return fontStrikes[fontId] ?? false;
  }

  // Shared strings table, if this file uses one instead of inline strings
  let sharedStrings: Array<{ text: string; runs?: StrikeRun[] }> = [];
  const sstFile = zip.file("xl/sharedStrings.xml");
  if (sstFile) {
    const sstXml = await sstFile.async("string");
    const sstDoc = parser.parse(sstXml);
    sharedStrings = asArray(sstDoc.sst?.si).map(parseRichTextNode);
  }

  const map = new Map<string, CellStrikeInfo>();
  const rowArr = asArray(sheetDoc.worksheet.sheetData.row);

  for (const row of rowArr) {
    if (!row?.c) continue;
    for (const cell of asArray(row.c)) {
      if (!cell) continue;
      const addr = cell["@_r"];
      const styleIdx = parseInt(cell["@_s"] ?? "0", 10);
      const type = cell["@_t"];

      if (type === "inlineStr" && cell.is) {
        const parsed = parseRichTextNode(cell.is);
        map.set(
          addr,
          parsed.runs
            ? { fullyStruck: parsed.runs.every((r) => r.struck), runs: parsed.runs }
            : { fullyStruck: styleIndexStruck(styleIdx) }
        );
      } else if (type === "s" && cell.v !== undefined) {
        const shared = sharedStrings[parseInt(String(cell.v), 10)];
        map.set(
          addr,
          shared?.runs
            ? { fullyStruck: shared.runs.every((r) => r.struck), runs: shared.runs }
            : { fullyStruck: styleIndexStruck(styleIdx) }
        );
      } else if (cell.v !== undefined) {
        map.set(addr, { fullyStruck: styleIndexStruck(styleIdx) });
      }
    }
  }

  return map;
}
