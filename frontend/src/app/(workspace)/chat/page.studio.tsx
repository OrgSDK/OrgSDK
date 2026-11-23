import type { ReactNode } from "react";
import Link from "next/link";
export default function Page(): ReactNode {
  return (
    <section className="panel">
      <h2>Built-in chat has been retired</h2>
      <p>
        Connect an external agent client to author and execute code in a
        project. Historical runs and their recorded conversation outputs remain
        available to authorized workspace members.
      </p>
      <p>
        <Link href="/runs/">Inspect archived runs</Link>
      </p>
      <p>
        <Link href="/connections/">Connect an external client</Link>
      </p>
    </section>
  );
}
