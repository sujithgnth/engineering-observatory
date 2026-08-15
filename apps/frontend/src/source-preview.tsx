import Editor, { loader } from "@monaco-editor/react";
import { useQuery } from "@tanstack/react-query";

import { api } from "./api";

loader.config({ paths: { vs: "/monaco/vs" } });

function language(filePath: string) {
  if (filePath.endsWith(".tsx") || filePath.endsWith(".ts"))
    return "typescript";
  return "javascript";
}

export default function SourcePreview({
  analysisId,
  filePath,
  line,
}: {
  analysisId: string;
  filePath: string;
  line: number | null;
}) {
  const source = useQuery({
    queryKey: ["source-preview", analysisId, filePath],
    queryFn: () => api.source(analysisId, filePath),
  });

  if (source.isLoading) {
    return (
      <p className="p-5 text-sm text-slate-400">Loading bounded source…</p>
    );
  }
  if (source.isError) {
    return (
      <p className="p-5 text-sm text-rose-300">
        Source preview unavailable: {source.error.message}
      </p>
    );
  }
  if (!source.data) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-950 px-4 py-2 text-xs text-slate-400">
        <span>{source.data.path}</span>
        <span>{source.data.byteSize.toLocaleString()} bytes · read only</span>
      </div>
      <Editor
        height="420px"
        path={source.data.path}
        language={language(source.data.path)}
        value={source.data.content}
        theme="vs-dark"
        line={line ?? 1}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbersMinChars: 3,
          renderLineHighlight: "all",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          wordWrap: "on",
        }}
      />
    </div>
  );
}
