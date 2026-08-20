import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { Button } from "./ui";

interface MarkdownViewerProps {
  content: string;
  onChange: (value: string) => void;
  onCopy: () => void;
  onClear: () => void;
}

type Tab = "code" | "preview";

export function MarkdownViewer({
  content,
  onChange,
  onCopy,
  onClear,
}: MarkdownViewerProps) {
  const [activeTab, setActiveTab] = useState<Tab>("code");
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    onCopy();
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="glass overflow-hidden flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-border-subtle bg-overlay/[0.06]">
        <TabButton active={activeTab === "code"} onClick={() => setActiveTab("code")}>
          Código Markdown
        </TabButton>
        <TabButton active={activeTab === "preview"} onClick={() => setActiveTab("preview")}>
          Prévia
        </TabButton>

        <div className="flex-1" />

        <Button variant="ghost" size="sm" aria-label="Copiar conteúdo" onClick={handleCopy}>
          {copied ? "Copiado!" : "Copiar"}
        </Button>

        <Button variant="ghost" size="sm" aria-label="Limpar resultado" onClick={onClear}>
          Limpar
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto max-h-[420px]">
        {activeTab === "code" ? (
          <textarea
            value={content}
            onChange={(e) => onChange(e.target.value)}
            aria-label="Conteúdo Markdown editável"
            spellCheck={false}
            className="selectable w-full h-full min-h-[420px] p-4 bg-transparent text-text-primary text-sm font-mono resize-none focus:outline-none leading-relaxed"
          />
        ) : (
          <div className="selectable p-6 prose prose-invert prose-sm max-w-none">
            <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
              {content}
            </Markdown>
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button size="sm" role="tab" aria-selected={active} aria-pressed={active} onClick={onClick}>
      {children}
    </Button>
  );
}
