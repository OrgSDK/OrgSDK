import { router } from "../procedures";
import { setupStatusProcedure } from "./setup-status";
import { setupProcedure } from "./setup";
import { sessionProcedure } from "./session";
import { browserSessionProcedure } from "./browser-session";
import { loginProcedure } from "./login";
import { logoutProcedure } from "./logout";
import { signupProcedure } from "./signup";
import { mfaAuthenticateProcedure } from "./mfa-authenticate";
import { reauthenticateProcedure } from "./reauthenticate";
import { mfaReauthenticateProcedure } from "./mfa-reauthenticate";
import { changePasswordProcedure } from "./change-password";
import { emailsProcedure } from "./emails";
import { changeEmailProcedure } from "./change-email";
import { authenticatorsProcedure } from "./authenticators";
import { totpSetupProcedure } from "./totp-setup";
import { enableTotpProcedure } from "./enable-totp";
import { disableTotpProcedure } from "./disable-totp";
import { recoveryCodesProcedure } from "./recovery-codes";
import { generateRecoveryCodesProcedure } from "./generate-recovery-codes";
export const authRouter = router({
  setupStatus: setupStatusProcedure,
  setup: setupProcedure,
  session: sessionProcedure,
  browserSession: browserSessionProcedure,
  login: loginProcedure,
  logout: logoutProcedure,
  signup: signupProcedure,
  mfaAuthenticate: mfaAuthenticateProcedure,
  reauthenticate: reauthenticateProcedure,
  mfaReauthenticate: mfaReauthenticateProcedure,
  changePassword: changePasswordProcedure,
  emails: emailsProcedure,
  changeEmail: changeEmailProcedure,
  authenticators: authenticatorsProcedure,
  totpSetup: totpSetupProcedure,
  enableTotp: enableTotpProcedure,
  disableTotp: disableTotpProcedure,
  recoveryCodes: recoveryCodesProcedure,
  generateRecoveryCodes: generateRecoveryCodesProcedure,
});
