import { ensureTestDbSchema } from "./ensureSchema";

export default async function setup(): Promise<void> {
  await ensureTestDbSchema();
}
