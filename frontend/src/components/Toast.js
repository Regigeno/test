import React from "react";

export default function Toast({ text, type = "info" }) {
  return (
    <div className={`toast ${type === "error" ? "error" : ""}`} data-testid="toast">
      {text}
    </div>
  );
}
