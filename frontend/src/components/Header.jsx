import { Bug } from "lucide-react";
import { Link } from "react-router-dom";

import { ModeBadge } from "./ModeBadge";
import { ThemeToggle } from "./ThemeToggle";

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-2 px-4">
        <Link to="/" className="flex min-h-[44px] items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-white">
            <Bug size={16} aria-hidden />
          </span>
          Fixsi
        </Link>
        <ModeBadge compact />
        <nav aria-label="Main" className="ml-auto flex items-center gap-1 text-sm">
          <Link to="/runs" className="flex min-h-[44px] items-center rounded-lg px-3 text-muted hover:text-fg">
            Runs
          </Link>
          <Link to="/how-it-works" className="flex min-h-[44px] items-center rounded-lg px-3 text-muted hover:text-fg">
            <span className="hidden sm:inline">How it works</span>
            <span className="sm:hidden">How</span>
          </Link>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
