import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import ChatApp from "./components/ChatApp";
import "./App.css";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ChatApp />} />
        <Route path="/c/:conversationId" element={<ChatApp />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
