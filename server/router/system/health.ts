import { publicProcedure } from "../procedures";
export const healthProcedure = publicProcedure.query(() => ({
  status: "ok",
  database: "sqlite",
  runtime: "bun",
}));
