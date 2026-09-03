/**
 * OUTLANDS-2A - the one place that binds the Outlands entrance to the real
 * `X3D.bxx.setIdentityProvider` seam.
 *
 * `bxx_identity.js` (OUTLANDS-1) already owns `Browser.myAvatarURL` and
 * `Browser.myAvatarName`, and its own comment reserves the avatar decision for
 * this lane. That seam is NOT replaced here - it is used exactly as it was
 * written, by registering one provider function.
 *
 * All of the thinking lives in `helpers/outlands.helper.ts`, which is pure and
 * fully tested. This module is only the wiring, so it stays a few lines long.
 *
 * The host is read late. `App.vue`'s `created()` is what runs
 * `require("./libs/x_ite_mods/bxx_identity.js")`, so `window.X3D.bxx` may not
 * exist when this module is first imported.
 */
import {
  OutlandsIdentityHost,
  OutlandsIdentitySession,
  createOutlandsIdentitySession,
} from "@/helpers/outlands.helper";

interface OutlandsWindow extends Window {
  X3D?: OutlandsIdentityHost;
}

function getHost(): OutlandsIdentityHost | null {
  if (typeof window === "undefined") { return null; }
  const scope = window as unknown as OutlandsWindow;
  return scope.X3D === undefined ? null : scope.X3D;
}

/** The single free-play selection for this browser session. */
const outlandsIdentity: OutlandsIdentitySession =
  createOutlandsIdentitySession(getHost);

export default outlandsIdentity;
