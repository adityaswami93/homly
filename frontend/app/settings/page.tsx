"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import Navbar from "@/app/components/Navbar";

const AVAILABLE_TOPICS = [
  "global markets",
  "Singapore economy",
  "Federal Reserve",
  "inflation",
  "oil prices",
  "China economy",
  "cryptocurrency",
  "SGX stocks",
  "MAS policy",
  "US economy",
];

const FREQUENCY_OPTIONS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
];

const TIME_OPTIONS = [
  { value: "06:00", label: "6:00 AM" },
  { value: "07:00", label: "7:00 AM" },
  { value: "08:00", label: "8:00 AM" },
  { value: "09:00", label: "9:00 AM" },
  { value: "10:00", label: "10:00 AM" },
  { value: "11:00", label: "11:00 AM" },
];

export default function Settings() {
  const [user, setUser] = useState<any>(null);
  const [digestEnabled, setDigestEnabled] = useState(true);
  const [digestTime, setDigestTime] = useState("07:00");
  const [digestFrequency, setDigestFrequency] = useState("daily");
  const [topics, setTopics] = useState<string[]>([
    "global markets",
    "Singapore economy",
    "Federal Reserve",
    "inflation",
  ]);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) router.push("/login");
      else {
        setUser(session.user);
        fetchPreferences();
      }
    });
  }, []);

  const fetchPreferences = async () => {
    const res = await api.get("/preferences");
    const prefs = res.data;
    setDigestEnabled(prefs.digest_enabled);
    setDigestTime(prefs.digest_time);
    setDigestFrequency(prefs.digest_frequency);
    setTopics(prefs.topics || []);
  };

  const toggleTopic = (topic: string) => {
    setTopics((prev) =>
      prev.includes(topic) ? prev.filter((t) => t !== topic) : [...prev, topic]
    );
  };

  const savePreferences = async () => {
    if (!user) return;
    setLoading(true);
    setSaved(false);
    await api.post("/preferences", {
      digest_enabled: digestEnabled,
      digest_time: digestTime,
      digest_frequency: digestFrequency,
      topics,
    });
    setLoading(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      <Navbar user={user} isAdmin={user?.email === process.env.NEXT_PUBLIC_ADMIN_EMAIL} />

      <div className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight mb-2">Settings</h1>
        <p className="text-white/40 mb-10">Manage your digest preferences.</p>

        {/* Digest toggle */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-6 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-medium mb-1">Morning Digest</h2>
              <p className="text-sm text-white/40">
                Receive a daily AI-generated market briefing in your inbox
              </p>
            </div>
            <button
              onClick={() => setDigestEnabled(!digestEnabled)}
              className={`w-12 h-6 rounded-full transition-colors relative ${
                digestEnabled ? "bg-emerald-500" : "bg-white/10"
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${
                  digestEnabled ? "translate-x-6" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        </div>

        {/* Digest frequency */}
        {digestEnabled && (
          <>
            <div className="bg-white/5 border border-white/10 rounded-xl p-6 mb-4">
              <h2 className="font-medium mb-4">Frequency</h2>
              <div className="flex gap-2">
                {FREQUENCY_OPTIONS.map((f) => (
                  <button
                    key={f.value}
                    onClick={() => setDigestFrequency(f.value)}
                    className={`px-4 py-2 rounded-lg text-sm border transition ${
                      digestFrequency === f.value
                        ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-400"
                        : "border-white/10 text-white/40 hover:text-white"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Digest time */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-6 mb-4">
              <h2 className="font-medium mb-4">Delivery Time (SGT)</h2>
              <div className="flex gap-2 flex-wrap">
                {TIME_OPTIONS.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setDigestTime(t.value)}
                    className={`px-4 py-2 rounded-lg text-sm border transition ${
                      digestTime === t.value
                        ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-400"
                        : "border-white/10 text-white/40 hover:text-white"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Topics */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-6 mb-8">
              <h2 className="font-medium mb-1">Topics</h2>
              <p className="text-sm text-white/40 mb-4">
                Select topics to include in your digest
              </p>
              <div className="flex flex-wrap gap-2">
                {AVAILABLE_TOPICS.map((topic) => (
                  <button
                    key={topic}
                    onClick={() => toggleTopic(topic)}
                    className={`text-sm px-3 py-1.5 rounded-lg border transition ${
                      topics.includes(topic)
                        ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-400"
                        : "border-white/10 text-white/40 hover:text-white"
                    }`}
                  >
                    {topic}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Save button */}
        <button
          onClick={savePreferences}
          disabled={loading}
          className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-black font-semibold px-8 py-3 rounded-xl transition"
        >
          {loading ? "Saving..." : saved ? "Saved ✓" : "Save preferences"}
        </button>
      </div>
    </main>
  );
}