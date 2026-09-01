import { createContext } from "react";

export type AdminContextValue = {
  authChecked: boolean;
  isAdmin: boolean;
  // Role tiers on top of admin: head = manage invite codes, owner = manage roles.
  isHead: boolean;
  isOwner: boolean;
  showAdminControls: boolean;
  isAdminUiExiting: boolean;
  userEmail: string;
  signOutAdmin: () => Promise<void>;
  refreshAdmin: () => Promise<void>;
  ensureAdminSession: () => Promise<boolean>;
};

export const AdminContext = createContext<AdminContextValue | null>(null);
