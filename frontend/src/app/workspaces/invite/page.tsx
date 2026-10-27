"use client";
import { Button } from "../../../components/ui/button";
import { Suspense, useState, type ReactNode } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { api } from "../../../api/client";
import { result, errorMessage } from "../../../api/result";
function InvitationForm(): ReactNode {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const [status, setStatus] = useState(
    "Sign in with the invited email address before accepting.",
  );
  return (
    <main>
      <section className="panel">
        <h1>Join this workspace</h1>
        <p role="status">{status}</p>
        <div className="row">
          <a
            className="button"
            href={`/accounts/login/?next=${encodeURIComponent(`/workspaces/invite/?token=${token}`)}`}
          >
            Sign in
          </a>
          <Button
            disabled={!token}
            onClick={() => {
              void (async () => {
                try {
                  result(await api.GET("/api/v1/session/"));
                  result(
                    await api.POST(
                      "/api/v1/workspaces/invitations/{token}/accept/",
                      { params: { path: { token } } },
                    ),
                  );
                  router.push("/");
                } catch (error) {
                  setStatus(errorMessage(error));
                }
              })();
            }}
          >
            Accept invitation
          </Button>
        </div>
      </section>
    </main>
  );
}

export default function Invitation(): ReactNode {
  return (
    <Suspense fallback={<p>Loading invitation…</p>}>
      <InvitationForm />
    </Suspense>
  );
}
