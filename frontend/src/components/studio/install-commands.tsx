import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";

const commands = "npm install -g @orgsdk/cli\norgsdk start";

export function InstallCommands(): ReactNode {
  const [feedback, setFeedback] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(commands);
      setFeedback("Copied");
    } catch {
      setFeedback("Select the commands to copy them.");
    }
  }
  return (
    <div className="studio-terminal">
      <div className="studio-terminal-bar">
        <span>Linux · Node.js 22.22+</span>
        <button
          aria-label="Copy install and start commands"
          onClick={() => void copy()}
        >
          {feedback === "Copied" ? <Check /> : <Copy />}Copy
        </button>
      </div>
      <pre>
        <code>{commands}</code>
      </pre>
      {feedback && (
        <span role="status" className="studio-copy-feedback">
          {feedback}
        </span>
      )}
    </div>
  );
}
