import React, { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const SUGGESTIONS = [
  { title: "Explain a concept", sub: "Explain quantum entanglement like I'm 12.", prompt: "Explain quantum entanglement like I'm 12." },
  { title: "Write some code", sub: "Write a Python function that checks if a string is a palindrome.", prompt: "Write a Python function that checks if a string is a palindrome and include 3 test cases." },
  { title: "Brainstorm ideas", sub: "5 creative app ideas for indie hackers.", prompt: "Give me 5 creative app ideas for indie hackers in 2026, with a one-line pitch each." },
  { title: "Summarize", sub: "Summarize the key benefits of REST vs GraphQL.", prompt: "Summarize the key benefits and trade-offs of REST vs GraphQL in a short table." },
];

export default function ChatWindow({ messages, isStreaming, onSuggestion, onCopy }) {
  const wrapRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages]);

  const handleCopy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      onCopy && onCopy();
    } catch {
      // noop
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="messages-wrap" ref={wrapRef} data-testid="messages-wrap">
      {isEmpty ? (
        <div className="empty-state" data-testid="empty-state">
          <div className="empty-logo">OA</div>
          <h1 className="empty-title">Prototype-OA</h1>
          <p className="empty-sub">
            A sleek chat interface powered by the <strong>owl-alpha</strong> model via OpenRouter.
            Ask anything — explanations, code, ideas, summaries.
          </p>
          <div className="suggestions">
            {SUGGESTIONS.map((s, i) => (
              <button
                key={i}
                className="suggestion"
                data-testid={`suggestion-${i}`}
                onClick={() => onSuggestion(s.prompt)}
              >
                <div className="suggestion-title">{s.title}</div>
                <div className="suggestion-sub">{s.sub}</div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="messages-inner">
          {messages.map((m, idx) => {
            const isUser = m.role === "user";
            const isLast = idx === messages.length - 1;
            const showTyping = m.role === "assistant" && isStreaming && isLast && !m.content;
            return (
              <div key={m.id || idx} className="message" data-testid={`message-${m.role}`}>
                <div className={`avatar ${isUser ? "user" : "assistant"}`}>
                  {isUser ? "You" : "OA"}
                </div>
                <div className="message-body">
                  <div className="message-name">{isUser ? "You" : "Prototype-OA"}</div>
                  <div className="message-content" data-testid={`message-content-${m.role}`}>
                    {showTyping ? (
                      <div className="typing"><span /><span /><span /></div>
                    ) : isUser ? (
                      <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
                    ) : (
                      <>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {m.content || ""}
                        </ReactMarkdown>
                        {m.streaming && <span className="stream-cursor" />}
                      </>
                    )}
                  </div>
                  {!m.streaming && !showTyping && m.content && (
                    <div className="message-actions">
                      <button
                        className="action-btn"
                        onClick={() => handleCopy(m.content)}
                        data-testid={`copy-btn-${idx}`}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        Copy
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
