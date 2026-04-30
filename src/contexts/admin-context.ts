import { createContext } from "react";

export type AdminContextValue = {
  authChecked: boolean;
  isAdmin: boolean;
  showAdminControls: boolean;
  isAdminUiExiting: boolean;
  isAdminPanelOpen: boolean;
  isAdminPanelClosing: boolean;
  userEmail: string;
  openAdminPanel: () => void;
  closeAdminPanel: () => void;
  signOutAdmin: () => Promise<void>;
  refreshAdmin: () => Promise<void>;
  ensureAdminSession: () => Promise<boolean>;
};

export const AdminContext = createContext<AdminContextValue | null>(null);
