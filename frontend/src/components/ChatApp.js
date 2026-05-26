import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Sidebar from "./Sidebar";
import ChatWindow from "./ChatWindow";
import Composer from "./Composer";
import Toast from "./Toast";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export default function ChatApp() {
  const navigate = useNavigate();
  const { conversationId: routeConvId } = useParams();

  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(routeConvId || null);
  const [messages, setMessages] = useState([]);
  const [activeTitle, setActiveTitle] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toast, setToast] = useState(null);
  const abortRef = useRef(null);
  // Track conversations whose in-flight stream is currently being rendered.
  // While set, route changes should NOT overwrite local message state.
  const streamingConvRef = useRef(null);

  const showToast = (text, type = "info") => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 2400);
  };

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch(`${API}/conversations`);
      if (!res.ok) return;
      const data = await res.json();
      setConversations(data);
    } catch (e) {
      console.error("Failed to load conversations", e);
    }
  }, []);

  const loadConversation = useCallback(async (id) => {
    if (!id) {
      setMessages([]);
      setActiveTitle("");
      return;
    }
    try {
      const res = await fetch(`${API}/conversations/${id}`);
      if (!res.ok) {
        if (res.status === 404) {
          navigate("/");
          setActiveId(null);
          setMessages([]);
        }
        return;
      }
      const data = await res.json();
      setMessages(data.messages || []);
      setActiveTitle(data.conversation?.title || "");
    } catch (e) {
      console.error(e);
    }
  }, [navigate]);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  useEffect(() => {
    setActiveId(routeConvId || null);
    // Don't overwrite messages if we are mid-stream for this conversation
    if (streamingConvRef.current && streamingConvRef.current === routeConvId) {
      return;
    }
    loadConversation(routeConvId || null);
  }, [routeConvId, loadConversation]);

  const handleNewChat = () => {
    if (isStreaming) return;
    setActiveId(null);
    setMessages([]);
    setActiveTitle("");
    navigate("/");
  };

  const handleSelectConversation = (id) => {
    if (isStreaming) return;
    navigate(`/c/${id}`);
  };

  const handleDeleteConversation = async (id) => {
    try {
      await fetch(`${API}/conversations/${id}`, { method: "DELETE" });
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
        navigate("/");
      }
      showToast("Conversation deleted");
    } catch (e) {
      showToast("Delete failed", "error");
    }
  };

  const handleRenameConversation = async (id, title) => {
    try {
      const res = await fetch(`${API}/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (res.ok) {
        const updated = await res.json();
        setConversations((prev) => prev.map((c) => (c.id === id ? updated : c)));
        if (activeId === id) setActiveTitle(updated.title);
      }
    } catch (e) {
      showToast("Rename failed", "error");
    }
  };

  const handleSend = async (text) => {
    const content = (text || "").trim();
    if (!content || isStreaming) return;

    const userMsg = {
      id: `tmp-${Date.now()}`,
      conversation_id: activeId || "pending",
      role: "user",
      content,
      created_at: new Date().toISOString(),
    };
    const assistantMsg = {
      id: `tmp-asst-${Date.now()}`,
      conversation_id: activeId || "pending",
      role: "assistant",
      content: "",
      created_at: new Date().toISOString(),
      streaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);
    streamingConvRef.current = activeId || "pending";

    const controller = new AbortController();
    abortRef.current = controller;

    let createdConvId = activeId;
    try {
      const res = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ conversation_id: activeId, message: content, stream: true }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";
      let newTitle = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const line = rawEvent.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          const dataStr = line.slice(5).trim();
          if (!dataStr) continue;
          try {
            const evt = JSON.parse(dataStr);
            if (evt.type === "meta") {
              createdConvId = evt.conversation_id;
              streamingConvRef.current = createdConvId;
              if (evt.is_new && createdConvId) {
                setActiveId(createdConvId);
                navigate(`/c/${createdConvId}`, { replace: true });
              }
            } else if (evt.type === "token") {
              assistantText += evt.content;
              setMessages((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last && last.role === "assistant") {
                  copy[copy.length - 1] = { ...last, content: assistantText };
                }
                return copy;
              });
            } else if (evt.type === "done") {
              newTitle = evt.title;
              createdConvId = evt.conversation_id || createdConvId;
            } else if (evt.type === "error") {
              throw new Error(evt.detail || "Stream error");
            }
          } catch (err) {
            console.warn("Bad SSE chunk", err);
          }
        }
      }

      // Finalize last message
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.role === "assistant") {
          copy[copy.length - 1] = { ...last, streaming: false };
        }
        return copy;
      });

      if (newTitle) setActiveTitle(newTitle);
      await fetchConversations();
    } catch (err) {
      if (err.name === "AbortError") {
        showToast("Generation stopped");
      } else {
        console.error(err);
        showToast(`Error: ${err.message}`.slice(0, 140), "error");
      }
      // Mark assistant message as not streaming and add error note if empty
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.role === "assistant") {
          copy[copy.length - 1] = {
            ...last,
            streaming: false,
            content: last.content || "_The response was interrupted._",
          };
        }
        return copy;
      });
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      streamingConvRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortRef.current) abortRef.current.abort();
  };

  return (
    <div className="app-shell" data-testid="app-shell">
      <Sidebar
        open={sidebarOpen}
        conversations={conversations}
        activeId={activeId}
        onNewChat={handleNewChat}
        onSelect={handleSelectConversation}
        onDelete={handleDeleteConversation}
        onRename={handleRenameConversation}
        onToggle={() => setSidebarOpen((s) => !s)}
      />
      {sidebarOpen && (
        <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
      )}

      <div className="main">
        <div className="topbar">
          <div className="topbar-left">
            <button
              className="icon-btn"
              data-testid="toggle-sidebar-btn"
              onClick={() => setSidebarOpen((s) => !s)}
              aria-label="Toggle sidebar"
              title="Toggle sidebar"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
            <div className="topbar-title" data-testid="topbar-title">
              {activeTitle || "New chat"}
            </div>
          </div>
          <div className="badge" data-testid="model-badge">OWL ALPHA</div>
        </div>

        <ChatWindow
          messages={messages}
          isStreaming={isStreaming}
          onSuggestion={handleSend}
          onCopy={() => showToast("Copied to clipboard")}
        />

        <Composer
          onSend={handleSend}
          onStop={handleStop}
          isStreaming={isStreaming}
        />
      </div>

      {toast && <Toast text={toast.text} type={toast.type} />}
    </div>
  );
}
