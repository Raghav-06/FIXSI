import { ShieldCheck } from "lucide-react";

import { ModeBadge } from "../components/ModeBadge";
import { StartPanel } from "../components/StartPanel";

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="pt-6 sm:pt-12">
        <div className="flex flex-wrap items-center gap-2">
          <ModeBadge />
          <span className="chip bg-raised text-muted">NVIDIA Nemotron · Nebius Token Factory</span>
        </div>
        <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-6xl">Fixsi</h1>
        <p className="mt-2 text-xl font-medium text-accent sm:text-2xl">It doesn&apos;t guess. It proves.</p>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted">
          An autonomous debugging agent. It investigates like a senior engineer, proves the root cause by writing a
          test that reproduces the bug, then fixes the code until that test passes — without breaking a single existing test.
        </p>
        <p className="mt-4 flex max-w-2xl items-start gap-2 text-sm text-fg/80">
          <ShieldCheck size={18} className="mt-0.5 shrink-0 text-pass" aria-hidden />
          The rule: no application code is edited until a failing reproduction test confirms a hypothesis.
        </p>
      </section>
      <StartPanel />
    </div>
  );
}
