import { eq } from "drizzle-orm";
import { z } from "zod";
import { plugins } from "../../db/schema";
import { projectGrant } from "../../domain/permissions";
import { canConfigurePlugin, pluginSettings } from "../../plugins/settings";
import { pluginsRepository } from "../../repositories/plugins";
import { projectsRepository } from "../../repositories/projects";
import { scopedManagerProcedure } from "../procedures";

export const settingsProcedure = scopedManagerProcedure("plugins:configure")
  .input(z.strictObject({ project: z.uuid() }))
  .query(({ ctx, input }) => {
    projectGrant(ctx, input.project);
    projectsRepository(ctx).find(input.project);
    return pluginsRepository(ctx)
      .list(eq(plugins.projectId, input.project))
      .filter(canConfigurePlugin)
      .map(pluginSettings);
  });
