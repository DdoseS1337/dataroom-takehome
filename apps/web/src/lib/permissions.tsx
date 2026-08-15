"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Permission } from "./queries";

/**
 * Read-only mode is one value threaded through the view tree and one hook, rather than
 * `{isOwner && <Button/>}` scattered across components — see docs/ui.md. With twenty
 * scattered checks you miss one, and the miss is in the sharing path.
 *
 * Hiding a control is presentation only. The API authorises every mutation itself.
 */
export type Action =
  | "createFolder"
  | "upload"
  | "rename"
  | "move"
  | "delete"
  | "share"
  | "history";

const ALLOWED_BY_ACTION: Record<Action, readonly Permission[]> = {
  createFolder: ["owner", "editor"],
  upload: ["owner", "editor"],
  rename: ["owner", "editor"],
  move: ["owner", "editor"],
  delete: ["owner", "editor"],
  // Re-sharing is the owner's alone: an editor handing out links would put the guest
  // list outside the owner's control.
  share: ["owner"],
  // Earlier versions likewise. A recipient can read the current document, so this is not
  // about the bytes — it is that the document was revised twice before they were shown
  // it, which is information about the deal rather than about the file.
  history: ["owner"],
};

const PermissionContext = createContext<Permission>("none");

export function PermissionProvider({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  return <PermissionContext value={permission}>{children}</PermissionContext>;
}

export function useCanPerform(action: Action): boolean {
  const permission = useContext(PermissionContext);
  return ALLOWED_BY_ACTION[action].includes(permission);
}
