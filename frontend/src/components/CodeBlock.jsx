import { Check, Copy, WrapText } from "lucide-react";
import { useState } from "react";

/** Icon-only below `sm` unless `showLabel` is set. */
export function CopyButton({ text, label = "Copy", showLabel = false }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-md px-2 text-xs text-muted hover:bg-raised hover:text-fg"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked */
        }
      }}
      aria-label={copied ? "Copied" : label}
    >
      {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      <span className={showLabel ? "" : "hidden sm:inline"}>{copied ? "Copied" : label}</span>
    </button>
  );
}

/** Scrolls horizontally inside its own box (never the page) with a wrap-lines toggle. */
export function CodeBlock({ code, title, children, maxHeight = "24rem", defaultWrap = false }) {
  const [wrap, setWrap] = useState(defaultWrap);
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-line bg-raised/60">
      <div className="flex items-center gap-1 border-b border-line pl-3 text-xs text-muted">
        <div className="min-w-0 flex-1 truncate font-mono">{title}</div>
        <button
          type="button"
          onClick={() => setWrap((w) => !w)}
          aria-pressed={wrap}
          className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-md px-2 hover:bg-raised ${wrap ? "text-accent" : ""}`}
          aria-label="Wrap lines"
        >
          <WrapText size={14} aria-hidden />
          <span className="hidden sm:inline">Wrap</span>
        </button>
        <CopyButton text={code} />
      </div>
      <pre
        className={`code-scroll overflow-y-auto p-3 font-mono text-[12.5px] leading-5 ${wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`}
        style={{ maxHeight }}
        tabIndex={0}
      >
        {children ?? code}
      </pre>
    </div>
  );
}

// comments | strings & template literals | keywords | numbers | regex-free on purpose (good enough for tests)
const JS = /(\/\/.*$|\/\*[\s\S]*?\*\/)|(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\b(import|from|export|default|const|let|var|function|return|class|new|extends|if|else|for|of|in|while|throw|try|catch|finally|async|await|yield|typeof|instanceof|null|undefined|true|false|this)\b|\b(\d+(?:\.\d+)?)\b|(=>)/gm;

export function JsCode({ code }) {
  const out = [];
  let last = 0;
  let i = 0;
  for (const m of code.matchAll(JS)) {
    const start = m.index ?? 0;
    if (start > last) out.push(code.slice(last, start));
    const cls = m[1] ? "text-muted italic" : m[2] ? "text-pass" : m[3] ? "text-super font-medium" : m[4] ? "text-warn" : "text-nano";
    out.push(<span key={i++} className={cls}>{m[0]}</span>);
    last = start + m[0].length;
  }
  out.push(code.slice(last));
  return <>{out}</>;
}

export function DiffLines({ diff }) {
  return (
    <>
      {diff.split("\n").map((line, i) => {
        let cls = "";
        let sr = "";
        if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("new file")) cls = "text-muted font-semibold";
        else if (line.startsWith("@@")) cls = "text-accent";
        else if (line.startsWith("+")) { cls = "bg-pass/10 text-pass"; sr = "added: "; }
        else if (line.startsWith("-")) { cls = "bg-fail/10 text-fail"; sr = "removed: "; }
        return (
          <span key={i} className={`diff-line block ${cls}`}>
            {sr && <span className="sr-only">{sr}</span>}
            {line || " "}
          </span>
        );
      })}
    </>
  );
}
