import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isolatedCommand } from "./isolated-actions";
import { executeIsolated, isolatedInputSchema } from "./isolated-worker";

const sdk = {
  plugins: [
    {
      namespace: "fixture",
      available: true,
      metadata_complete: true,
      tools: [
        {
          name: "send",
          parameters: [{ name: "message", type: "string" }],
          returnType: "Promise<string>",
        },
      ],
    },
  ],
};
function input(source: string, cases: unknown[]) {
  return { operation: "test", source, sdk, test_suite: { cases } };
}

test("isolated Docker command grants no production network, mount, credentials or entrypoint", () => {
  const command = isolatedCommand("fixture", "image", [
    "--mount",
    "type=bind,src=/runtime/src,dst=/executor/src,readonly",
  ]);
  expect(command).toContain("--network=none");
  expect(command).toContain("--read-only");
  expect(command).toContain("/work");
  expect(command).toContain("--cap-drop=ALL");
  expect(command).toContain("--security-opt=no-new-privileges");
  expect(command).toContain("/executor/src/isolated-worker.ts");
  expect(command.join(" ")).not.toMatch(
    /\/agent|DJANGO_URL|TOKEN|SECRET|host-gateway/,
  );
});

test("isolated payload rejects a full job or credential data", () => {
  expect(() =>
    isolatedInputSchema.parse({
      operation: "validate",
      source: "return 42;",
      sdk: {},
      capability: "secret",
    }),
  ).toThrow();
  expect(
    isolatedInputSchema.parse({
      operation: "validate",
      source: "return 42;",
      sdk: {
        plugins: [
          {
            namespace: "fixture",
            available: true,
            source: "danger",
            configuration: { secret: "x" },
            credential_id: "key",
          },
        ],
      },
    }).sdk,
  ).toEqual({ plugins: [{ namespace: "fixture", available: true }] });
});

test("actual isolated VM uses mocks and catches forbidden calls even when source catches errors", async () => {
  const root = await mkdtemp(join(tmpdir(), "orgsdk-isolated-"));
  try {
    const result = await executeIsolated(
      input("return await fixture.send('hello');", [
        {
          name: "mocked",
          inputs: {},
          expected: "ok",
          mocks: [{ tool: "fixture.send", args: ["hello"], result: "ok" }],
        },
      ]),
      root,
    );
    expect("passed" in result && result.passed).toBe(true);
    const caught = await executeIsolated(
      input("try { await fixture.send('hello'); } catch {} return 42;", [
        {
          name: "caught",
          inputs: {},
          expected: 42,
          mocks: [],
          forbidden_calls: ["fixture.send"],
        },
      ]),
      root,
    );
    expect("passed" in caught && caught.passed).toBe(false);
    expect(JSON.stringify(caught)).toContain("Forbidden call");
    const unexpected = await executeIsolated(
      input("try { await saveArtifact('x','y'); } catch {} return 42;", [
        { name: "unexpected", inputs: {}, expected: 42 },
      ]),
      root,
    );
    expect("passed" in unexpected && unexpected.passed).toBe(false);
    expect(JSON.stringify(unexpected)).toContain("Unexpected call");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("isolated cases have separate scratch files and enforce mock consumption", async () => {
  const root = await mkdtemp(join(tmpdir(), "orgsdk-isolated-files-"));
  try {
    const result = await executeIsolated(
      input(
        "if(actionParams.write) await writeFile('note.txt','hello'); try { return await readFile('note.txt'); } catch { return 'missing'; }",
        [
          { name: "first", inputs: { write: true }, expected: "hello" },
          { name: "next", inputs: { write: false }, expected: "missing" },
        ],
      ),
      root,
    );
    expect("passed" in result && result.passed).toBe(true);
    const unconsumed = await executeIsolated(
      input("return 42;", [
        {
          name: "unused",
          inputs: {},
          expected: 42,
          mocks: [{ tool: "fixture.send", args: [], result: "unused" }],
        },
      ]),
      root,
    );
    expect("passed" in unconsumed && unconsumed.passed).toBe(false);
    expect(JSON.stringify(unconsumed)).toContain("Unconsumed mock");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("isolated validation runs before mocked or real scratch effects and respects cancellation", async () => {
  const root = await mkdtemp(join(tmpdir(), "orgsdk-isolated-validation-"));
  try {
    const invalid = await executeIsolated(
      input(
        "await writeFile('note.txt','hello'); const x: number = 'bad'; return x;",
        [{ name: "invalid", inputs: {}, expected: 42 }],
      ),
      root,
    );
    expect("passed" in invalid && invalid.passed).toBe(false);
    expect("cases" in invalid && invalid.cases).toEqual([]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      executeIsolated(
        input("return 42;", [{ name: "cancelled", inputs: {}, expected: 42 }]),
        root,
        controller.signal,
      ),
    ).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("production semantic validation rejects errors before live capability calls", async () => {
  const { Runner } = await import("./runner");
  const { Client } = await import("./client");
  const { jobSchema } = await import("./contract");
  const claim = jobSchema.parse({
    protocol_version: 3,
    operation: "action",
    run_id: crypto.randomUUID(),
    workspace_id: 1,
    actor_id: 1,
    capability: "secret",
    inputs: {},
    deadline: new Date(Date.now() + 60000).toISOString(),
    lease_seconds: 60,
    snapshot: {
      root_agent_id: "agent",
      validation_mode: "semantic",
      sdk: { plugins: [] },
      source:
        "await saveArtifact('x','y'); const x: number = 'wrong'; return x;",
      agents: [
        {
          id: "agent",
          name: "Agent",
          instructions: "",
          model: "",
          credential_id: null,
          plugins: [],
          documents: [],
        },
      ],
    },
  });
  let calls = 0;
  class NoCalls extends Client {
    override async request() {
      calls++;
      throw new Error("Live call forbidden");
    }
  }
  await expect(
    new Runner(
      claim,
      new NoCalls("http://fixture", "token"),
      new AbortController().signal,
    ).run(),
  ).rejects.toThrow("Semantic validation failed");
  expect(calls).toBe(0);
});

test("camelCase namespaces match object arguments across VM realms", async () => {
  const root = await mkdtemp(join(tmpdir(), "orgsdk-isolated-camel-"));
  try {
    const result = await executeIsolated(
      {
        operation: "test",
        source: "return await queryFixture.query({ids:[1,2],active:true});",
        sdk: {
          plugins: [
            {
              namespace: "queryFixture",
              available: true,
              metadata_complete: true,
              tools: [
                {
                  name: "query",
                  parameters: [
                    {
                      name: "options",
                      type: "{ids: number[]; active: boolean}",
                    },
                  ],
                  returnType: "Promise<number>",
                },
              ],
            },
          ],
        },
        test_suite: {
          cases: [
            {
              name: "object",
              inputs: {},
              expected: 42,
              mocks: [
                {
                  tool: "queryFixture.query",
                  args: [{ ids: [1, 2], active: true }],
                  result: 42,
                },
              ],
            },
          ],
        },
      },
      root,
    );
    expect("passed" in result && result.passed).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("undeclared calls on incomplete namespaces fail even when caught", async () => {
  const root = await mkdtemp(join(tmpdir(), "orgsdk-isolated-incomplete-"));
  try {
    const result = await executeIsolated(
      {
        operation: "test",
        source: "try { await provider.undeclaredSend(); } catch {} return 42;",
        sdk: {
          plugins: [
            {
              namespace: "provider",
              available: true,
              metadata_complete: false,
              tools: null,
            },
          ],
        },
        test_suite: { cases: [{ name: "caught", inputs: {}, expected: 42 }] },
      },
      root,
    );
    expect("passed" in result && result.passed).toBe(false);
    expect(JSON.stringify(result)).toContain(
      "Unexpected call: provider.undeclaredSend",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("isolated parent cancels Docker and reports through its own capability", async () => {
  const { writeFile, chmod, readFile } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "orgsdk-isolated-parent-"));
  const commandPath = join(root, "docker");
  const parentPath = Bun.resolveSync("./isolated-actions.ts", import.meta.dir);
  const capturedPath = join(root, "payload.json");
  const killedPath = join(root, "killed");
  await writeFile(
    commandPath,
    `#!${process.execPath}\nif(process.argv[2]==='kill'){await Bun.write(${JSON.stringify(killedPath)},'killed');}else{const payload=await Bun.stdin.text();await Bun.write(${JSON.stringify(capturedPath)},payload);await Bun.sleep(60000);}\n`,
  );
  await chmod(commandPath, 0o755);
  const script = `
    import {runIsolatedJob} from ${JSON.stringify(parentPath)};
    const requests=[];
    const server=Bun.serve({port:0,async fetch(request){requests.push({path:new URL(request.url).pathname,auth:request.headers.get('authorization'),body:await request.json().catch(()=>null)});return new Response(null,{status:204});}});
    const controller=new AbortController();
    const timer=setInterval(async()=>{if(await Bun.file(${JSON.stringify(capturedPath)}).exists()){clearInterval(timer);controller.abort();}},10);
    const job={operation:'test',run_id:'fixture',capability:'parent-only',deadline:new Date(Date.now()+60000).toISOString(),snapshot:{source:'return 42;',sdk:{plugins:[]},test_suite:{id:'suite',revision:2,digest:'digest',cases:[{name:'case',inputs:{},expected:42}]},agents:[{credential_id:'private',plugins:[{source:'private plugin'}]}]}};
    await runIsolatedJob(job,server.url.toString(),[],controller.signal);
    await server.stop(true);
    console.log(JSON.stringify(requests));
  `;
  try {
    const child = Bun.spawn([process.execPath, "--eval", script], {
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH}`,
        EXECUTOR_IMAGE: "fixture",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    const requests = JSON.parse(stdout);
    expect(requests.at(-1).body.status).toBe("cancelled");
    expect(requests.at(-1).auth).toBe("Bearer parent-only");
    const payload = JSON.parse(await readFile(capturedPath, "utf8"));
    expect(payload.test_suite).toEqual({
      cases: [
        {
          name: "case",
          inputs: {},
          expected: 42,
          mocks: [],
          forbidden_calls: [],
        },
      ],
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /parent-only|credential|private|agents/,
    );
    // The Docker kill command is asynchronous; the parent still kills its CLI immediately.
    await Bun.sleep(100);
    expect(await Bun.file(killedPath).text()).toBe("killed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
