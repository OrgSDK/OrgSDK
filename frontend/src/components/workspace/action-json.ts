import { z } from "zod";
const jsonObject = z.record(z.string(), z.json());
export function parseActionJSON(text: string): z.infer<typeof jsonObject> {
  const value: unknown = JSON.parse(text);
  return jsonObject.parse(value);
}
export function parseActionCases(text: string): z.infer<typeof jsonObject>[] {
  const value: unknown = JSON.parse(text);
  return z.array(jsonObject).min(1).max(50).parse(value);
}
