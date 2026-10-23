import { Moon, Sun } from "lucide-react";
import { useState } from "react";

export function ThemeToggle() {
  // index.html applies the saved theme before first paint; read it back here.
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("fixsi-theme", next ? "dark" : "light");
    } catch {
      /* storage blocked */
    }
  };
  return (
    <button type="button" onClick={toggle} className="btn-ghost w-11 px-0" aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
      {dark ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
    </button>
  );
}
