/** An expected failure at the API boundary: the field the Creator can fix and a plain message. */
export type ParseFailure = {ok: false; field: string; message: string};

export type ParseResult<Value> = {ok: true; value: Value} | ParseFailure;

export function parseFailure(field: string, message: string): ParseFailure {
  return {ok: false, field, message};
}

export function parseSuccess<Value>(value: Value): ParseResult<Value> {
  return {ok: true, value};
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function mapParseResult<Value, Mapped>(result: ParseResult<Value>, convert: (value: Value) => Mapped): ParseResult<Mapped> {
  return result.ok ? parseSuccess(convert(result.value)) : result;
}
