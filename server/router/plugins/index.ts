import { configureProcedure } from "./configure";
import { settingsProcedure } from "./settings";
import { shellRulesProcedure } from "./shell-rules";
import { setShellRuleProcedure } from "./set-shell-rule";
import { mcpRouter } from "./mcp";
import { router } from "../procedures";
import { listProcedure } from "./list";
import { getProcedure } from "./get";
import { createProcedure } from "./create";
import { updateProcedure } from "./update";
import { deleteProcedure } from "./delete";
import { catalogProcedure } from "./catalog";
import { searchLibraryProcedure } from "./search-library";
import { marketplaceProcedure } from "./marketplace";
export const pluginsRouter = router({
  mcp: mcpRouter,
  shellRules: shellRulesProcedure,
  setShellRule: setShellRuleProcedure,
  list: listProcedure,
  settings: settingsProcedure,
  configure: configureProcedure,
  get: getProcedure,
  create: createProcedure,
  update: updateProcedure,
  delete: deleteProcedure,
  catalog: catalogProcedure,
  marketplace: marketplaceProcedure,
  searchLibrary: searchLibraryProcedure,
});
