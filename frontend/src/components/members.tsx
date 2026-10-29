"use client";
import { MailPlus, Trash2, Users } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import { trpc } from "../api/trpc";
import type { Invitation } from "../api/types";
import { errorMessage } from "../api/result";
import { useWorkspaceQuery } from "../api/use-workspace-query";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ResourceState } from "./workspace/resource-state";
import { useDiscardConfirmation } from "./workspace/discard-dialog";
function invitationStatus(invite: Invitation): string {
  if (invite.accepted_at) return "Accepted";
  if (invite.revoked_at) return "Revoked";
  return new Date(invite.expires_at) < new Date() ? "Expired" : "Pending";
}
export function Members({
  onChanged,
}: {
  onChanged: () => Promise<void>;
}): ReactNode {
  const query = useWorkspaceQuery(
    useCallback(
      (signal: AbortSignal) =>
        trpc.workspace.current.query(undefined, { signal }),
      [],
    ),
  );
  const canConfirm = useDiscardConfirmation();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [isBusy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const currentRole = query.data?.role;
  const canManage = currentRole === "owner" || currentRole === "admin";
  const perform = async (task: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
      await query.refresh();
      await onChanged();
    } catch (error_) {
      setError(errorMessage(error_));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <section className="panel">
        <div className="panel-title">
          <h2>
            <Users size={18} /> Workspace members
          </h2>
          <span className="badge">
            {query.data?.members.length ?? 0} people
          </span>
        </div>
        <ResourceState {...query} />
        {query.data?.members.map((member) => (
          <div className="resource-row" key={member.id}>
            <div>
              <strong>{member.email}</strong>
              <small>{member.username}</small>
            </div>
            {currentRole === "owner" && member.role !== "owner" ? (
              <select
                className="member-role"
                aria-label={`Role for ${member.email}`}
                value={member.role}
                disabled={isBusy}
                onChange={(event) => {
                  const nextRole =
                    event.target.value === "admin" ? "admin" : "member";
                  void perform(async () => {
                    await trpc.workspace.updateMember.mutate({
                      id: member.id,
                      role: nextRole,
                    });
                    setNotice("Member role updated.");
                  });
                }}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            ) : (
              <span className="badge">{member.role}</span>
            )}
            {canManage &&
            member.role !== "owner" &&
            (currentRole === "owner" || member.role === "member") ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${member.email}`}
                disabled={isBusy}
                onClick={() => {
                  void perform(async () => {
                    if (
                      !(await canConfirm({
                        title: "Remove this member?",
                        description: `${member.email} will lose access to this workspace.`,
                        actionLabel: "Remove member",
                      }))
                    )
                      return;
                    await trpc.workspace.removeMember.mutate({ id: member.id });
                    setNotice("Member removed.");
                  });
                }}
              >
                <Trash2 size={14} />
              </Button>
            ) : undefined}
            {currentRole === "owner" && member.role !== "owner" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={isBusy}
                onClick={() => {
                  void perform(async () => {
                    if (
                      !(await canConfirm({
                        title: "Transfer workspace ownership?",
                        description: `${member.email} will become the owner. Your own role will change to admin.`,
                        actionLabel: "Transfer ownership",
                      }))
                    )
                      return;
                    await trpc.workspace.transferOwnership.mutate({
                      membership_id: member.id,
                    });
                    setNotice("Ownership transferred.");
                  });
                }}
              >
                Make owner
              </Button>
            ) : undefined}
          </div>
        ))}
      </section>
      {canManage ? (
        <>
          <section className="panel">
            <h2>
              <MailPlus size={18} /> Invite a teammate
            </h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void perform(async () => {
                  await trpc.workspace.invite.mutate({ email, role });
                  setEmail("");
                  setNotice("Invitation queued.");
                });
              }}
            >
              <div className="row">
                <label>
                  Invite by email
                  <Input
                    type="email"
                    required
                    value={email}
                    disabled={isBusy}
                    onChange={(event) => {
                      setEmail(event.target.value);
                    }}
                  />
                </label>
                <label>
                  Invitation role
                  <select
                    value={role}
                    disabled={isBusy}
                    onChange={(event) => {
                      setRole(
                        event.target.value === "admin" ? "admin" : "member",
                      );
                    }}
                  >
                    <option value="member">Member</option>
                    {currentRole === "owner" ? (
                      <option value="admin">Admin</option>
                    ) : undefined}
                  </select>
                </label>
              </div>
              <Button type="submit" disabled={isBusy}>
                Invite member
              </Button>
            </form>
          </section>
          <section className="panel">
            <h2>Invitations</h2>
            {query.data?.invitations.length === 0 ? (
              <p className="small">No invitations have been sent.</p>
            ) : undefined}
            {query.data?.invitations.map((invite) => (
              <div className="resource-row" key={invite.id}>
                <div>
                  <strong>{invite.email}</strong>
                  <small>
                    {invite.role} · Expires{" "}
                    {new Date(invite.expires_at).toLocaleString()}
                  </small>
                </div>
                <span className="badge">{invitationStatus(invite)}</span>
                {!invite.accepted_at &&
                !invite.revoked_at &&
                (currentRole === "owner" || invite.role === "member") ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => {
                      void perform(async () => {
                        await trpc.workspace.revokeInvitation.mutate({
                          id: invite.id,
                        });
                        setNotice("Invitation revoked.");
                      });
                    }}
                  >
                    Revoke
                  </Button>
                ) : undefined}
              </div>
            ))}
          </section>
        </>
      ) : undefined}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : undefined}
      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : undefined}
    </>
  );
}
