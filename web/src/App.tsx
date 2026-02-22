import { useConvexAuth } from "convex/react";
import { SignIn } from "@clerk/clerk-react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Dashboard } from "./components/Dashboard";
import { VoiceWarmup } from "./components/VoiceWarmup";

export default function App() {
  const { isLoading, isAuthenticated } = useConvexAuth();

  if (isLoading) {
    return (
      <div className="app">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="app">
        <div className="card" style={{ display: "flex", justifyContent: "center" }}>
          <SignIn routing="hash" />
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/warmup" element={<VoiceWarmup />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </div>
  );
}
