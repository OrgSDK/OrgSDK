import { spawnProcess, workerCommand } from "../process-runtime";

// Keep the supervisor's input pipe readable even if the session's VM is busy.
// In host mode the supervisor owns the pipe. In Docker, the attached CLI
// forwards EOF to the container's stdin when the supervisor disappears.
const worker = spawnProcess(workerCommand(import.meta.url, "./worker"), {
  stdout: "pipe",
  stderr: "ignore",
});
const stop = () => {
  worker.kill("SIGKILL");
  process.stdin.destroy();
};
// Keep reading to EOF even if a CPU-bound worker stops reading commands.
// The supervisor sends one cell at a time and bounds commands and tool results.
process.stdin.on("data", (chunk: Buffer) => worker.stdin.write(chunk));
process.stdin.once("end", stop);
process.stdin.once("error", stop);
process.stdout.once("error", stop);
worker.stdout.pipe(process.stdout, { end: false });
try {
  process.exitCode = await worker.exited;
} finally {
  process.stdin.destroy();
}
