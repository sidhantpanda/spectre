import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import EnrollPage from "./pages/EnrollPage";
import TerminalPage from "./pages/TerminalPage";
import { AuthGate } from "./components/AuthGate";
import { ThemeProvider } from "./components/ThemeProvider";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthGate>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<App />} />
            <Route path="/enroll" element={<EnrollPage />} />
            <Route path="/agent/:deviceId" element={<TerminalPage />} />
            <Route path="/agent/:deviceId/:sessionId" element={<TerminalPage />} />
          </Routes>
        </BrowserRouter>
      </AuthGate>
    </ThemeProvider>
  </React.StrictMode>
);
