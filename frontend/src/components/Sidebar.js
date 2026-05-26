import React, { useState } from "react";

export default function Sidebar({
  open,
  conversations,
  activeId,
  onNewChat,
  onSelect,
  onDelete,
  onRename,
  onToggle,
}) {
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");

  const startEdit = (c) => {
    setEditingId(c.id);
    setEditValue(c.title);
  };
  const commitEdit = (id) => {
    const val = editValue.trim();
    if (val) onRename(id, val);
    setEditingId(null);
    setEditValue("");
  };

  return (
    <aside className={`sidebar ${open ? "" : "collapsed"}`} data-testid="sidebar">
      <div className="sidebar-header">
        <div className="brand">
          <div className="brand-logo">OA</div>
          <div>
            <div className="brand-name">Prototype-OA</div>
            <div className="brand-sub">powered by owl-alpha</div>
          </div>
        </div>
        <button className="icon-btn" onClick={onToggle} title="Hide sidebar" aria-label="Hide sidebar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
      </div>

      <button className="new-chat-btn" data-testid="new-chat-btn" onClick={onNewChat}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        New chat
      </button>

      <div className="sidebar-section-title">Recent</div>

      <div className="convo-list" data-testid="convo-list">
        {conversations.length === 0 && (
          <div style={{ padding: "10px 14px", fontSize: 12.5, color: "var(--text-3)" }}>
            No conversations yet. Start one below!
          </div>
        )}
        {conversations.map((c) => (
          <div
            key={c.id}
            className={`convo-item ${c.id === activeId ? "active" : ""}`}
            data-testid={`convo-item-${c.id}`}
            onClick={() => editingId !== c.id && onSelect(c.id)}
          >
            {editingId === c.id ? (
              <input
                autoFocus
                className="convo-title"
                style={{
                  background: "rgba(0,0,0,0.3)",
                  border: "1px solid var(--border-strong)",
                  color: "var(--text-1)",
                  padding: "4px 6px",
                  borderRadius: 6,
                  outline: "none",
                  fontSize: 13.5,
                }}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={() => commitEdit(c.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdit(c.id);
                  if (e.key === "Escape") { setEditingId(null); setEditValue(""); }
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="convo-title" title={c.title}>{c.title}</span>
            )}
            <div className="convo-actions">
              <button
                className="convo-action"
                title="Rename"
                onClick={(e) => { e.stopPropagation(); startEdit(c); }}
                data-testid={`rename-convo-${c.id}`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button
                className="convo-action danger"
                title="Delete"
                onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
                data-testid={`delete-convo-${c.id}`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <div className="footer-model">
          <span className="live-dot" />
          openrouter/owl-alpha
        </div>
      </div>
    </aside>
  );
}
