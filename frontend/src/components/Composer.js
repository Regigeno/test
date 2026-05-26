import React, { useEffect, useRef, useState } from "react";

export default function Composer({ onSend, onStop, isStreaming }) {
  const [value, setValue] = useState("");
  const taRef = useRef(null);

  const autosize = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`;
  };

  useEffect(() => { autosize(); }, [value]);

  const submit = () => {
    const text = value.trim();
    if (!text || isStreaming) return;
    onSend(text);
    setValue("");
    requestAnimationFrame(autosize);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="composer-wrap">
      <div className="composer" data-testid="composer">
        <textarea
          ref={taRef}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isStreaming ? "Generating response…" : "Message Prototype-OA…"}
          data-testid="composer-input"
          disabled={false}
        />
        {isStreaming ? (
          <button
            className="send-btn stop"
            onClick={onStop}
            title="Stop generating"
            data-testid="stop-btn"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
          </button>
        ) : (
          <button
            className="send-btn"
            disabled={!value.trim()}
            onClick={submit}
            title="Send (Enter)"
            data-testid="send-btn"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        )}
      </div>
      <div className="composer-hint">
        Press <kbd style={{ background: "rgba(255,255,255,0.06)", padding: "1px 6px", borderRadius: 4, border: "1px solid var(--border)" }}>Enter</kbd> to send · <kbd style={{ background: "rgba(255,255,255,0.06)", padding: "1px 6px", borderRadius: 4, border: "1px solid var(--border)" }}>Shift + Enter</kbd> for newline
      </div>
    </div>
  );
}
