import { useRef, useState } from "react";

interface JsonInputPanelProps {
  title: string;
  value: string;
  error: string | null;
  onChange: (value: string) => void;
}

export function JsonInputPanel({
  title,
  value,
  error,
  onChange,
}: JsonInputPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  async function onFile(file: File | null) {
    setFileError(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".json")) {
      setFileError("Please upload a .json file.");
      return;
    }
    try {
      const text = await file.text();
      onChange(text);
    } catch {
      setFileError("Failed to read file.");
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{title}</h2>
        <label className="btn file-btn">
          Upload .json
          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json"
            onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>
      <label className="label" htmlFor={`json-${title}`}>
        Paste JSON
      </label>
      <textarea
        id={`json-${title}`}
        className="field"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        placeholder='{"example": true}'
      />
      {error ? <div className="error-text">{error}</div> : null}
      {fileError ? <div className="error-text">{fileError}</div> : null}
    </section>
  );
}
