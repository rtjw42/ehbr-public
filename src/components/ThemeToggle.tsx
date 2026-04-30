import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Switch } from "@/components/ui/switch";

export const ThemeToggle = () => {
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const saved = localStorage.getItem("dark-mode");
    return saved === null ? false : saved === "1";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem("dark-mode", darkMode ? "1" : "0");
  }, [darkMode]);

  return (
    <div className="flex items-center gap-2">
      <Sun className="h-4 w-4 text-muted-foreground" />
      <Switch checked={darkMode} onCheckedChange={setDarkMode} aria-label="Toggle dark mode" />
      <Moon className="h-4 w-4 text-muted-foreground" />
    </div>
  );
};
