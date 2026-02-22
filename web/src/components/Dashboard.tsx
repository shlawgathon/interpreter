import { useQuery, useMutation } from "convex/react";
import { useClerk, useUser } from "@clerk/clerk-react";
import { api } from "../../convex/_generated/api";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "zh", name: "Chinese" },
  { code: "de", name: "German" },
  { code: "ja", name: "Japanese" },
  { code: "pt", name: "Portuguese" },
  { code: "ko", name: "Korean" },
  { code: "hi", name: "Hindi" },
  { code: "ar", name: "Arabic" },
];

export function Dashboard() {
  const { signOut } = useClerk();
  const { user } = useUser();
  const profile = useQuery(api.userProfiles.getMyProfile);
  const createOrUpdate = useMutation(api.userProfiles.createOrUpdateProfile);
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState("");
  const [language, setLanguage] = useState("en");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Profile is loading
  if (profile === undefined) {
    return <div className="loading">Loading profile...</div>;
  }

  // No profile yet — show setup form
  if (profile === null) {
    return (
      <div className="card">
        <h1>Set Up Profile</h1>
        <p>Configure your display name and preferred language.</p>

        <div className="form-group">
          <label>Display Name</label>
          <input
            type="text"
            value={displayName || user?.fullName || ""}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
          />
        </div>

        <div className="form-group">
          <label>Language</label>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="error-msg">{error}</p>}

        <button
          className="btn btn-primary"
          disabled={saving || !(displayName.trim() || user?.fullName)}
          onClick={async () => {
            setSaving(true);
            setError("");
            try {
              await createOrUpdate({
                displayName: displayName.trim() || user?.fullName || "User",
                language,
              });
            } catch (err: any) {
              setError(err.message || "Failed to create profile");
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving..." : "Create Profile"}
        </button>

        <button className="btn btn-link" onClick={() => signOut()}>
          Sign Out
        </button>
      </div>
    );
  }

  // Profile exists — show dashboard
  const statusBadge = {
    none: "badge-none",
    recording: "badge-processing",
    processing: "badge-processing",
    ready: "badge-ready",
    failed: "badge-failed",
  }[profile.voiceProfileStatus];

  const statusLabel = {
    none: "Not Set Up",
    recording: "Recording",
    processing: "Processing",
    ready: "Ready",
    failed: "Failed",
  }[profile.voiceProfileStatus];

  return (
    <>
      <div className="card">
        <div className="header">
          <h1>Dashboard</h1>
          <button className="btn btn-secondary" onClick={() => signOut()}>
            Sign Out
          </button>
        </div>

        <div className="profile-info">
          <div className="item">
            <div className="label">Name</div>
            <div className="value">{profile.displayName}</div>
          </div>
          <div className="item">
            <div className="label">Language</div>
            <div className="value">
              {LANGUAGES.find((l) => l.code === profile.language)?.name ||
                profile.language}
            </div>
          </div>
          <div className="item">
            <div className="label">Voice Clone</div>
            <div className="value">
              <span className={`badge ${statusBadge}`}>{statusLabel}</span>
            </div>
          </div>
          {profile.voiceProfileId && (
            <div className="item">
              <div className="label">Profile ID</div>
              <div className="value" style={{ fontSize: 12, wordBreak: "break-all" }}>
                {profile.voiceProfileId}
              </div>
            </div>
          )}
          <div className="item">
            <div className="label">User ID</div>
            <div className="value" style={{ fontSize: 12, wordBreak: "break-all" }}>
              {profile.userId}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Voice Clone</h2>
        {profile.voiceProfileStatus === "ready" ? (
          <>
            <p>
              Your voice profile is ready. Use the profile ID in the Chrome
              extension to enable voice cloning during calls.
            </p>
            <button
              className="btn btn-primary"
              onClick={() => navigate("/warmup")}
            >
              Re-record Voice Sample
            </button>
          </>
        ) : profile.voiceProfileStatus === "failed" ? (
          <>
            <p>
              Voice profile creation failed. Try recording again with a clear,
              steady voice in a quiet environment.
            </p>
            <button
              className="btn btn-primary"
              onClick={() => navigate("/warmup")}
            >
              Try Again
            </button>
          </>
        ) : (
          <>
            <p>
              Record a voice sample to create your personalized voice clone. The
              translated speech in calls will sound like you.
            </p>
            <div className="steps">
              <div className="step">
                <div className="step-num">1</div>
                <div className="step-text">
                  <strong>Record</strong>
                  <span>Read a passage aloud for 30-60 seconds</span>
                </div>
              </div>
              <div className="step">
                <div className="step-num">2</div>
                <div className="step-text">
                  <strong>Process</strong>
                  <span>We create your unique voice profile</span>
                </div>
              </div>
              <div className="step">
                <div className="step-num">3</div>
                <div className="step-text">
                  <strong>Use</strong>
                  <span>
                    Copy the profile ID into the Chrome extension
                  </span>
                </div>
              </div>
            </div>
            <button
              className="btn btn-primary"
              onClick={() => navigate("/warmup")}
            >
              Start Voice Setup
            </button>
          </>
        )}
      </div>
    </>
  );
}
