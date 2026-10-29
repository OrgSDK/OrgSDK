import { router } from "../procedures";
import { listProcedure } from "./list";
import { currentProcedure } from "./current";
import { updateProcedure } from "./update";
import { createProcedure } from "./create";
import { selectProcedure } from "./select";
import { inviteProcedure } from "./invite";
import { revokeInvitationProcedure } from "./revoke-invitation";
import { acceptInvitationProcedure } from "./accept-invitation";
import { updateMemberProcedure } from "./update-member";
import { removeMemberProcedure } from "./remove-member";
import { transferOwnershipProcedure } from "./transfer-ownership";
export const workspaceRouter = router({
  list: listProcedure,
  current: currentProcedure,
  update: updateProcedure,
  create: createProcedure,
  select: selectProcedure,
  invite: inviteProcedure,
  revokeInvitation: revokeInvitationProcedure,
  acceptInvitation: acceptInvitationProcedure,
  updateMember: updateMemberProcedure,
  removeMember: removeMemberProcedure,
  transferOwnership: transferOwnershipProcedure,
});
