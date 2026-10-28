import { openStore } from "../db";
import { credentials, plugins } from "../db/schema";
import type { PluginMetadata } from "../db/types";
import { base } from "../shared/records";
import { rpcFixture } from "./rpc-fixture";

export function pluginRaceFixture() {
  const fixture = rpcFixture();
  const concurrentStore = openStore(fixture.directory);
  const previousCatalog = process.env.PLUGIN_CATALOG_PATH;
  delete process.env.PLUGIN_CATALOG_PATH;
  const release: PluginMetadata & {
    slug: string;
    version: string;
    digest: string;
    package_url: string;
    distribution: "external";
  } = {
    slug: "external-test",
    version: "1",
    digest: "a".repeat(64),
    package_url: "https://example.test/plugin.tgz",
    display_name: "Test",
    description: "Catalog description",
    category: "test",
    documentation: "",
    distribution: "external",
    contract_version: 1,
    auth: { type: "token", provider: "test-provider" },
    marketplace: {},
    configuration_schema: { type: "object" },
    tools: [],
  };
  const credential = fixture.store.db
    .insert(credentials)
    .values({
      ...base(fixture.workspace.id),
      name: "Test API",
      provider: "test-provider",
      encryptedSecret: fixture.store.secrets.encrypt("{}"),
    })
    .returning()
    .get();
  const input = {
    project: fixture.project.id,
    slug: release.slug,
    version: release.version,
    distribution: release.distribution,
    credential: credential.id,
  };
  return {
    ...fixture,
    concurrentStore,
    release,
    credential,
    input,
    install() {
      return concurrentStore.db
        .insert(plugins)
        .values({
          ...base(fixture.workspace.id),
          projectId: fixture.project.id,
          slug: release.slug,
          version: release.version,
          digest: release.digest,
          distribution: release.distribution,
          packageUrl: release.package_url,
          releaseMetadata: release,
          credentialId: credential.id,
        })
        .returning()
        .get();
    },
    close() {
      concurrentStore.close();
      fixture.close();
      if (previousCatalog === undefined) {
        delete process.env.PLUGIN_CATALOG_PATH;
      } else {
        process.env.PLUGIN_CATALOG_PATH = previousCatalog;
      }
    },
  };
}

export function catalogFetch(operation: () => Response): typeof fetch {
  return Object.assign(() => Promise.resolve(operation()), { preconnect() {} });
}
