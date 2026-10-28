import { HttpError } from "../http/responses";

export function paginateData<Item>(
  items: Item[],
  offset: number,
  limit: number,
) {
  const selected: Item[] = [];
  for (const item of items.slice(offset, offset + limit)) {
    const responseBytes = Buffer.byteLength(
      JSON.stringify({
        items: [...selected, item],
        next_offset: offset + selected.length + 1,
      }),
    );
    if (responseBytes > 200_000) {
      if (selected.length === 0) {
        throw new HttpError(400, "Resource exceeds the response limit.");
      }
      break;
    }
    selected.push(item);
  }
  return {
    items: selected,
    next_offset:
      offset + selected.length < items.length ? offset + selected.length : null,
  };
}
