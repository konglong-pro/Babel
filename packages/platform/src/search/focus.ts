import { literalIndexOf } from "./text";

export interface SearchFocus<Field extends string = string> {
  query: string;
  field: Field;
}

type SearchParamValue = string | string[] | undefined;

export function searchFocusFromParams<Field extends string>(
  params: Record<string, SearchParamValue>,
  fields: ReadonlySet<Field>,
): SearchFocus<Field> | null {
  const rawQuery = firstParam(params.search);
  const field = firstParam(params.searchField);
  const query = rawQuery?.trim() ?? "";
  if (!query || field === undefined || !fields.has(field as Field)) return null;
  return { query, field: field as Field };
}

export function appendSearchFocus<Field extends string>(
  params: URLSearchParams,
  focus: SearchFocus<Field> | null | undefined,
): void {
  if (focus === null || focus === undefined) return;
  params.set("search", focus.query);
  params.set("searchField", focus.field);
}

export function literalSourceLine(value: string, query: string): number | undefined {
  const match = literalIndexOf(value, query);
  if (match < 0) return undefined;

  let line = 1;
  for (let index = 0; index < match; index += 1) {
    if (value[index] === "\r") {
      if (value[index + 1] === "\n") index += 1;
      line += 1;
    } else if (value[index] === "\n") {
      line += 1;
    }
  }
  return line;
}

function firstParam(value: SearchParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
