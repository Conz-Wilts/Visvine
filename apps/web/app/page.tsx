"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import WaitlistModal from "@/components/WaitlistModal";

/* ── Headshot-style avatar component ── */
function Avatar({ name, initials, src, size = 40, className = "" }: { name: string; initials: string; src?: string; size?: number; className?: string }) {
  /* AI-generated headshot URLs — replace with real headshots when available */
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        className={`rounded-full object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  /* Fallback: styled initial avatar with photo-like gradient */
  const colors: Record<string, string> = {
    S: "from-blue-500 to-indigo-600",
    A: "from-emerald-500 to-teal-600",
    J: "from-violet-500 to-purple-600",
    E: "from-rose-500 to-pink-600",
    G: "from-amber-500 to-orange-600",
    D: "from-red-500 to-rose-600",
    C: "from-cyan-500 to-sky-600",
    L: "from-lime-500 to-green-600",
    M: "from-fuchsia-500 to-purple-600",
    R: "from-orange-500 to-red-600",
  };
  const grad = colors[initials[0]] || "from-gray-500 to-gray-700";
  return (
    <div
      className={`rounded-full bg-gradient-to-br ${grad} flex items-center justify-center text-white font-bold shrink-0 shadow-inner ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </div>
  );
}

export default function HomePage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);

  /* Auto-cycle product demo slides */
  const nextSlide = useCallback(() => setCurrentSlide(s => (s + 1) % 3), []);
  useEffect(() => {
    const id = setInterval(nextSlide, 6000);
    return () => clearInterval(id);
  }, [nextSlide]);

  return (
    <div className="min-h-screen bg-brand-bg relative">
      <WaitlistModal open={modalOpen} onClose={() => setModalOpen(false)} />

      {/* ── Top gradient glow — Composite-style ambient light from above ── */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[600px] overflow-hidden z-0">
        <div className="absolute left-1/2 -translate-x-1/2 -top-32 w-[900px] h-[500px] rounded-full bg-brand-green/12 blur-[120px]" />
        <div className="absolute left-1/2 -translate-x-1/2 -top-16 w-[500px] h-[300px] rounded-full bg-brand-green/8 blur-[80px]" />
      </div>

      {/* ── Navbar — floating pill ── */}
      <div className="fixed top-4 left-0 right-0 z-50 flex justify-center px-6">
        <nav className="w-full max-w-4xl flex items-center gap-4 px-4 py-2.5 bg-white/85 backdrop-blur-xl rounded-full shadow-lg shadow-black/[0.04] border border-white/60">
          <Link href="/" className="text-2xl font-bold tracking-tight font-ginto shrink-0 pl-1" style={{ color: '#78d870' }}>
            Visvine
          </Link>
          <div className="flex-1 flex items-center justify-center gap-1">
            <a href="#features" className="text-sm text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-all px-4 py-1.5 rounded-full">Features</a>
            <a href="#how-it-works" className="text-sm text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-all px-4 py-1.5 rounded-full">How it works</a>
            <a href="#pricing" className="text-sm text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-all px-4 py-1.5 rounded-full">Pricing</a>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/signin"
              className="h-9 flex items-center px-4 rounded-full text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-all"
            >
              Log in
            </Link>
            <button
              onClick={() => setModalOpen(true)}
              className="h-9 flex items-center px-5 rounded-full bg-brand-green text-white text-sm font-semibold hover:brightness-105 transition-all shadow-sm shadow-brand-green/25"
            >
              Join Waitlist
            </button>
          </div>
        </nav>
      </div>

      {/* ── Hero ── */}
      <section className="relative z-10 overflow-hidden pt-32 pb-0 px-6">
        <div className="relative max-w-3xl mx-auto text-center mb-10">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-white/80 backdrop-blur-sm border border-brand-green/15 text-brand-dark-green text-xs font-semibold px-4 py-2 rounded-full mb-6 shadow-sm shadow-brand-green/5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-green opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-green" />
            </span>
            NOW IN EARLY ACCESS
          </div>

          {/* Headline — Composite-style with italic accent */}
          <h1 className="text-4xl lg:text-[56px] font-bold text-gray-900 leading-[1.08] mb-5 font-ginto tracking-tight">
            Map Your Network.{" "}
            <span className="text-brand-green italic">Unlock</span>{" "}
            Every Connection.
          </h1>
          <p className="text-lg text-gray-500 leading-relaxed mb-8 max-w-xl mx-auto">
            Describe your community. Watch it come alive. Your members, events, and relationships — turned into a living, interactive knowledge graph.
          </p>

          {/* CTAs — Composite-style: primary + outline */}
          <div className="flex items-center justify-center gap-3 mb-4">
            <button
              onClick={() => setModalOpen(true)}
              className="h-12 flex items-center px-8 rounded-full bg-brand-green text-white font-semibold text-sm hover:brightness-105 transition-all shadow-lg shadow-brand-green/25"
            >
              Get Early Access
            </button>
            <Link
              href="/signin"
              className="h-12 flex items-center gap-2 rounded-full border border-gray-200 bg-white text-gray-600 text-sm font-medium px-6 hover:border-gray-300 hover:shadow-sm transition-all"
            >
              Log in →
            </Link>
          </div>
          <p className="text-xs text-gray-400">Free during beta. No credit card required.</p>
        </div>

        {/* ── Product demo window ── */}
        <div className="relative max-w-6xl mx-auto">
          {/* Ambient glow behind window */}
          <div className="pointer-events-none absolute -inset-x-12 -top-8 h-48 bg-brand-green/5 blur-3xl rounded-full" />

          {/* Navigation arrows */}
          <button
            onClick={() => setCurrentSlide(s => (s - 1 + 3) % 3)}
            className="absolute -left-14 top-1/2 -translate-y-1/2 z-10 w-11 h-11 rounded-full bg-white/90 backdrop-blur-sm shadow-lg border border-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-900 hover:shadow-xl transition-all"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
          </button>
          <button
            onClick={() => setCurrentSlide(s => (s + 1) % 3)}
            className="absolute -right-14 top-1/2 -translate-y-1/2 z-10 w-11 h-11 rounded-full bg-white/90 backdrop-blur-sm shadow-lg border border-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-900 hover:shadow-xl transition-all"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
          </button>

          {/* Browser chrome */}
          <div className="rounded-2xl overflow-hidden shadow-2xl shadow-black/[0.08] border border-gray-200/60 bg-white">
            {/* Title bar */}
            <div className="bg-[#F6F6F6] px-4 py-3 flex items-center gap-3 border-b border-gray-200/40">
              <div className="flex gap-2 shrink-0">
                <div className="w-3 h-3 rounded-full bg-[#FF5F57]" />
                <div className="w-3 h-3 rounded-full bg-[#FEBC2E]" />
                <div className="w-3 h-3 rounded-full bg-[#28C840]" />
              </div>
              <div className="flex-1 flex justify-center">
                <div className="bg-white rounded-lg px-4 py-1.5 text-[11px] text-gray-400 border border-gray-200/60 w-72 text-center">
                  {["visvine.com/directory", "visvine.com/messages", "visvine.com/data"][currentSlide]}
                </div>
              </div>
              <div className="w-12" /> {/* spacer for symmetry */}
            </div>

            {/* Scaled app content */}
            <div className="bg-brand-bg overflow-hidden aspect-video">
              <div style={{ width: '1280px', height: '720px', transform: 'scale(0.85)', transformOrigin: 'top left' }}>

                {/* Shared app navbar */}
                <div className="h-16 bg-white/70 backdrop-blur-sm border-b border-gray-200/50 px-6 grid grid-cols-[auto_1fr_auto] items-center gap-6">
                  <div className="flex items-center gap-4">
                    <span className="text-2xl font-bold tracking-tight font-ginto" style={{ color: '#78d870' }}>Visvine</span>
                    <div className="flex items-center gap-1.5 bg-brand-bg rounded-full border border-gray-200/60 px-3 py-1.5 text-xs text-gray-600">
                      <span>Founders Network</span>
                      <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
                    </div>
                  </div>
                  <div className="flex justify-center">
                    <div className="w-full max-w-lg bg-brand-bg rounded-full border border-gray-200/60 px-4 py-2 text-sm text-gray-400 flex items-center gap-2">
                      <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                      Search or ask anything…
                    </div>
                  </div>
                  <Avatar name="You" initials="SC" size={36} />
                </div>

                {/* ── Slide 0: Directory with AI headshots ── */}
                {currentSlide === 0 && (
                  <>
                    <div className="flex items-center justify-between gap-4 px-6 pt-5 pb-0">
                      <div className="text-4xl font-normal tracking-tight text-gray-900 font-ginto">Directory</div>
                      <div className="relative flex items-center gap-1 rounded-full border border-gray-200/60 bg-white p-1 shadow-sm">
                        {[
                          { label: 'Graph', active: false },
                          { label: 'Grid',  active: true  },
                          { label: 'Table', active: false },
                        ].map(v => (
                          <div key={v.label} className={`flex h-10 items-center gap-1.5 rounded-full px-4 text-xs font-semibold transition-all ${v.active ? 'bg-brand-green text-white shadow-sm shadow-brand-green/25' : 'text-gray-500 hover:bg-gray-50'}`}>
                            {v.label}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 px-6 pt-3 pb-1">
                      {[{ label: 'Type', value: 'All' }, { label: 'Tag', value: 'All' }].map(f => (
                        <button key={f.label} className="flex h-9 items-center gap-1.5 rounded-full border border-gray-200/60 bg-white px-3 text-xs font-semibold text-gray-700 shadow-sm">
                          <span className="text-gray-400 font-normal">{f.label}:</span>
                          <span>{f.value}</span>
                          <svg className="h-3.5 w-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
                        </button>
                      ))}
                      <button className="flex h-9 items-center gap-1.5 rounded-full border border-gray-200/60 bg-white px-3 text-xs font-semibold text-gray-700 shadow-sm">
                        <span className="text-gray-400 font-normal">Sort:</span>
                        <span>A → Z</span>
                      </button>
                    </div>

                    {/* Directory grid with headshot-style avatars */}
                    <div className="w-full px-6 pt-4">
                      <div className="grid grid-cols-5 gap-4">
                        {[
                          { name: "Sarah Chen",     type: "People",       subtitle: "Founder & CEO at Acme",        color: "#2563eb", initials: "SC" },
                          { name: "Acme Corp",      type: "Startup",      subtitle: "B2B SaaS · Seed stage",        color: "#16a34a", initials: "AC" },
                          { name: "Demo Day '25",   type: "Event",        subtitle: "Spring 2025 cohort showcase",   color: "#ef4444", initials: "DD" },
                          { name: "John Park",      type: "People",       subtitle: "General Partner at GV",        color: "#2563eb", initials: "JP" },
                          { name: "GreenFund LP",   type: "Organization", subtitle: "Climate-focused venture fund",  color: "#9333ea", initials: "GF" },
                          { name: "Cohort III",     type: "Group",        subtitle: "YC W25 · 24 companies",        color: "#0ea5e9", initials: "C3" },
                          { name: "Emily Torres",   type: "People",       subtitle: "CTO · Previously Google",      color: "#2563eb", initials: "ET" },
                          { name: "LaunchHouse",    type: "Startup",      subtitle: "Community-led coworking",       color: "#16a34a", initials: "LH" },
                          { name: "Summit 2025",    type: "Event",        subtitle: "Annual founder retreat",        color: "#ef4444", initials: "S5" },
                          { name: "Atlas Ventures", type: "Organization", subtitle: "Multi-stage growth equity",     color: "#9333ea", initials: "AV" },
                        ].map((node) => (
                          <div key={node.name} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col h-[380px] hover:shadow-md transition-shadow">
                            {/* Card header with large avatar */}
                            <div className="h-[180px] shrink-0 flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 relative overflow-hidden">
                              {/* Decorative background pattern */}
                              <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)', backgroundSize: '16px 16px' }} />
                              <Avatar name={node.name} initials={node.initials} size={80} className="shadow-lg" />
                            </div>
                            <div className="p-4 flex flex-col flex-1 min-h-0">
                              <h3 className="font-semibold text-gray-900 text-base leading-tight line-clamp-2 mb-2">{node.name}</h3>
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold mb-2 w-fit text-white" style={{ backgroundColor: node.color }}>
                                {node.type}
                              </span>
                              <p className="text-gray-500 text-sm leading-relaxed line-clamp-2">{node.subtitle}</p>
                              <div className="mt-auto pt-3 border-t border-gray-100 flex gap-2">
                                <button className="flex-1 flex items-center justify-center gap-1.5 rounded-full border border-gray-200 text-gray-500 text-xs font-semibold py-1.5 hover:bg-gray-50 transition-colors">
                                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/></svg>
                                  Invite
                                </button>
                                <button className="flex-1 flex items-center justify-center gap-1.5 rounded-full bg-brand-green text-white text-xs font-semibold py-1.5 shadow-sm hover:brightness-105 transition-all">
                                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/></svg>
                                  Message
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* ── Slide 1: Messages ── */}
                {currentSlide === 1 && (
                  <div className="flex" style={{ height: '656px' }}>
                    {/* Conversations sidebar */}
                    <div className="w-80 border-r border-gray-200/50 bg-white flex flex-col shrink-0">
                      <div className="px-4 pt-5 pb-3">
                        <h2 className="text-3xl font-normal tracking-tight text-gray-900 font-ginto mb-3">Messages</h2>
                        <div className="bg-gray-50 rounded-full px-3 py-2 flex items-center gap-2 border border-gray-100">
                          <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                          <span className="text-sm text-gray-400">Search messages…</span>
                        </div>
                      </div>
                      <div className="flex-1 overflow-hidden">
                        {[
                          { name: "Sarah Chen",     preview: "Sounds great! Let's connect next week", time: "2m",  initials: "SC", unread: 2 },
                          { name: "Founders Group", preview: "Emily: Who's joining Demo Day?",         time: "14m", initials: "FG", unread: 5 },
                          { name: "John Park",      preview: "Thanks for the intro!",                 time: "1h",  initials: "JP", unread: 0 },
                          { name: "YC W25 Cohort",  preview: "Marcus: Office hours are at 3pm",       time: "3h",  initials: "YC", unread: 0 },
                          { name: "Emily Torres",   preview: "Just shipped the new feature",          time: "5h",  initials: "ET", unread: 0 },
                          { name: "Atlas Ventures", preview: "Can we schedule a call this week?",     time: "1d",  initials: "AV", unread: 0 },
                        ].map((conv, i) => (
                          <div key={conv.name} className={`flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-gray-50 transition-colors hover:bg-gray-50/50 ${i === 0 ? 'bg-brand-green/[0.04]' : ''}`}>
                            <div className="relative shrink-0">
                              <Avatar name={conv.name} initials={conv.initials} size={40} />
                              {conv.unread > 0 && <div className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-brand-green rounded-full flex items-center justify-center text-[9px] text-white font-bold ring-2 ring-white">{conv.unread}</div>}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <span className={`text-sm truncate ${conv.unread > 0 ? 'font-bold text-gray-900' : 'font-semibold text-gray-800'}`}>{conv.name}</span>
                                <span className="text-[10px] text-gray-400 shrink-0 ml-1">{conv.time}</span>
                              </div>
                              <p className={`text-xs truncate ${conv.unread > 0 ? 'text-gray-600 font-medium' : 'text-gray-400'}`}>{conv.preview}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Chat area */}
                    <div className="flex-1 flex flex-col bg-brand-bg min-w-0">
                      <div className="h-14 bg-white/80 backdrop-blur-sm border-b border-gray-200/50 px-5 flex items-center gap-3 shrink-0">
                        <Avatar name="Sarah Chen" initials="SC" size={32} />
                        <div>
                          <div className="text-sm font-semibold text-gray-900">Sarah Chen</div>
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                            <span className="text-[10px] text-green-500 font-medium">Online</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex-1 px-5 py-4 flex flex-col gap-3 overflow-hidden">
                        <div className="flex gap-2.5" style={{ maxWidth: '65%' }}>
                          <Avatar name="Sarah Chen" initials="SC" size={28} className="mt-auto" />
                          <div>
                            <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-2.5 shadow-sm border border-gray-100">
                              <p className="text-sm text-gray-800">Hey! I saw your profile on the network. Would love to connect and hear more about your work at Visvine!</p>
                            </div>
                            <span className="text-[10px] text-gray-400 mt-1 ml-1 block">10:32 AM</span>
                          </div>
                        </div>
                        <div className="flex gap-2.5 ml-auto flex-row-reverse" style={{ maxWidth: '65%' }}>
                          <div className="w-7 h-7 rounded-full bg-brand-green flex items-center justify-center text-white text-[10px] font-bold shrink-0 mt-auto shadow-sm">ME</div>
                          <div>
                            <div className="bg-brand-green rounded-2xl rounded-tr-sm px-4 py-2.5 shadow-sm">
                              <p className="text-sm text-white">Thanks Sarah! I&apos;d love that. I&apos;ve been building tools for community operators — would be great to get your feedback!</p>
                            </div>
                            <span className="text-[10px] text-gray-400 mt-1 mr-1 text-right block">10:34 AM</span>
                          </div>
                        </div>
                        <div className="flex gap-2.5" style={{ maxWidth: '65%' }}>
                          <Avatar name="Sarah Chen" initials="SC" size={28} className="mt-auto" />
                          <div>
                            <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-2.5 shadow-sm border border-gray-100">
                              <p className="text-sm text-gray-800">Sounds great! Let&apos;s connect next week — I&apos;m free Tuesday or Wednesday afternoon</p>
                            </div>
                            <span className="text-[10px] text-gray-400 mt-1 ml-1 block">10:35 AM</span>
                          </div>
                        </div>
                      </div>

                      <div className="px-5 pb-4 shrink-0">
                        <div className="bg-white rounded-2xl border border-gray-200/60 px-4 py-3 flex items-center gap-3 shadow-sm">
                          <div className="flex-1 text-sm text-gray-400">Write a message…</div>
                          <div className="w-8 h-8 rounded-full bg-brand-green flex items-center justify-center shrink-0 shadow-sm shadow-brand-green/25">
                            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Slide 2: Data ── */}
                {currentSlide === 2 && (
                  <div className="px-6 pt-5">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-4xl font-normal tracking-tight text-gray-900 font-ginto">Data</h2>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 rounded-full border border-gray-200/60 bg-white p-1 shadow-sm">
                          {['Nodes', 'Links', 'Communities'].map((tab, i) => (
                            <div key={tab} className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${i === 0 ? 'bg-brand-green text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}>{tab}</div>
                          ))}
                        </div>
                        <button className="flex items-center gap-1.5 h-9 px-4 rounded-full bg-brand-green text-white text-xs font-semibold shadow-sm shadow-brand-green/25 hover:brightness-105 transition-all">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
                          Add Node
                        </button>
                      </div>
                    </div>

                    <div className="bg-white rounded-xl border border-gray-200/60 overflow-hidden shadow-sm">
                      <div className="grid border-b border-gray-200/60 bg-gray-50/80" style={{ gridTemplateColumns: '48px 1fr 120px 200px 180px 130px 100px' }}>
                        {['', 'Name', 'Type', 'Subtitle', 'Tags', 'Created', 'Actions'].map(col => (
                          <div key={col} className="px-3 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{col}</div>
                        ))}
                      </div>
                      {[
                        { name: "Sarah Chen",     type: "People",       subtitle: "Founder & CEO at Acme",        tags: ["founder", "saas"],   created: "Jan 15, 2025", initials: "SC" },
                        { name: "Acme Corp",      type: "Startup",      subtitle: "B2B SaaS · Seed stage",        tags: ["b2b", "seed"],        created: "Jan 16, 2025", initials: "AC" },
                        { name: "Demo Day '25",   type: "Event",        subtitle: "Spring 2025 cohort showcase",   tags: ["showcase", "cohort"], created: "Feb 1, 2025",  initials: "DD" },
                        { name: "John Park",      type: "People",       subtitle: "General Partner at GV",        tags: ["investor", "gp"],     created: "Feb 3, 2025",  initials: "JP" },
                        { name: "GreenFund LP",   type: "Organization", subtitle: "Climate-focused venture fund",  tags: ["climate", "fund"],    created: "Feb 10, 2025", initials: "GF" },
                        { name: "Cohort III",     type: "Group",        subtitle: "YC W25 · 24 companies",        tags: ["yc", "cohort"],       created: "Mar 1, 2025",  initials: "C3" },
                        { name: "Emily Torres",   type: "People",       subtitle: "CTO · Previously Google",      tags: ["cto", "engineer"],    created: "Mar 5, 2025",  initials: "ET" },
                      ].map((row, i) => (
                        <div key={row.name} className={`grid items-center border-b border-gray-100/60 hover:bg-gray-50/40 transition-colors ${i % 2 === 1 ? 'bg-gray-50/30' : ''}`} style={{ gridTemplateColumns: '48px 1fr 120px 200px 180px 130px 100px' }}>
                          <div className="px-3 py-3">
                            <Avatar name={row.name} initials={row.initials} size={28} />
                          </div>
                          <div className="px-3 py-3 text-sm font-semibold text-gray-900">{row.name}</div>
                          <div className="px-3 py-3">
                            <span className="inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold text-white" style={{ backgroundColor: ({ People: '#2563eb', Startup: '#16a34a', Event: '#ef4444', Organization: '#9333ea', Group: '#0ea5e9' } as Record<string,string>)[row.type] || '#6b7280' }}>{row.type}</span>
                          </div>
                          <div className="px-3 py-3 text-xs text-gray-500 truncate">{row.subtitle}</div>
                          <div className="px-3 py-3 flex gap-1 flex-wrap">
                            {row.tags.map(tag => (
                              <span key={tag} className="px-2 py-0.5 rounded-full bg-gray-100 text-[10px] text-gray-600 font-medium">{tag}</span>
                            ))}
                          </div>
                          <div className="px-3 py-3 text-xs text-gray-400">{row.created}</div>
                          <div className="px-3 py-3 flex gap-2">
                            <button className="text-gray-400 hover:text-gray-600 transition-colors">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                            </button>
                            <button className="text-gray-400 hover:text-red-500 transition-colors">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            </div>
          </div>

          {/* Slide indicators */}
          <div className="flex items-center justify-center gap-6 mt-6">
            {['Directory', 'Messages', 'Data'].map((label, i) => (
              <button
                key={label}
                onClick={() => setCurrentSlide(i)}
                className={`flex items-center gap-2 text-xs font-semibold transition-all ${currentSlide === i ? 'text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}
              >
                <div className={`h-2 rounded-full transition-all ${currentSlide === i ? 'bg-brand-green w-5' : 'bg-gray-300 w-2'}`} />
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Social proof ── */}
      <section className="py-12 px-6">
        <div className="max-w-5xl mx-auto">
          <p className="text-center text-[11px] text-gray-400 uppercase tracking-[0.2em] mb-6">Trusted by community builders at</p>
          <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-4">
            {["Alumni Networks", "VC Firms", "Accelerators", "Startup Studios", "University Labs"].map(n => (
              <span key={n} className="text-sm font-semibold text-gray-300 tracking-wide">{n}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="py-24 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 bg-brand-green/10 text-brand-dark-green text-xs font-semibold px-4 py-2 rounded-full mb-4">
              FEATURES
            </div>
            <h2 className="text-4xl lg:text-5xl font-bold text-gray-900 font-ginto mb-3 tracking-tight">
              Everything your community{" "}
              <span className="text-brand-green italic">needs</span>
            </h2>
            <p className="text-gray-500 max-w-xl mx-auto text-lg">One platform for managing members, mapping relationships, and understanding your network.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-5">
            {/* Feature 1 — Graph */}
            <div className="bg-white rounded-2xl p-6 border border-gray-100 hover:shadow-xl hover:shadow-gray-100/60 hover:-translate-y-0.5 transition-all group">
              <div className="w-11 h-11 bg-brand-green/10 rounded-xl flex items-center justify-center mb-4 group-hover:bg-brand-green group-hover:text-white transition-colors">
                <svg width="20" height="20" viewBox="0 0 18 18" fill="none">
                  <circle cx="9" cy="9" r="3" fill="currentColor" className="text-brand-green group-hover:text-white transition-colors"/>
                  <circle cx="2.5" cy="4" r="1.8" fill="currentColor" className="text-brand-green/50 group-hover:text-white/60 transition-colors"/>
                  <circle cx="15.5" cy="4" r="1.8" fill="currentColor" className="text-brand-green/50 group-hover:text-white/60 transition-colors"/>
                  <circle cx="2.5" cy="14" r="1.8" fill="currentColor" className="text-brand-green/50 group-hover:text-white/60 transition-colors"/>
                  <circle cx="15.5" cy="14" r="1.8" fill="currentColor" className="text-brand-green/50 group-hover:text-white/60 transition-colors"/>
                  <line x1="9" y1="9" x2="2.5" y2="4" stroke="currentColor" strokeWidth="1.2" className="text-brand-green/40 group-hover:text-white/40 transition-colors"/>
                  <line x1="9" y1="9" x2="15.5" y2="4" stroke="currentColor" strokeWidth="1.2" className="text-brand-green/40 group-hover:text-white/40 transition-colors"/>
                  <line x1="9" y1="9" x2="2.5" y2="14" stroke="currentColor" strokeWidth="1.2" className="text-brand-green/40 group-hover:text-white/40 transition-colors"/>
                  <line x1="9" y1="9" x2="15.5" y2="14" stroke="currentColor" strokeWidth="1.2" className="text-brand-green/40 group-hover:text-white/40 transition-colors"/>
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900 text-lg mb-2">Interactive Graph</h3>
              <p className="text-sm text-gray-500 leading-relaxed mb-4">Force-directed network canvas shows every relationship. Click any node to explore connections instantly.</p>
              <div className="bg-brand-bg rounded-xl h-36 flex items-center justify-center overflow-hidden">
                <svg width="160" height="120" viewBox="0 0 160 120">
                  <line x1="80" y1="60" x2="40" y2="30" stroke="#78d870" strokeWidth="1.5" opacity="0.6"/>
                  <line x1="80" y1="60" x2="125" y2="25" stroke="#78d870" strokeWidth="1.5" opacity="0.6"/>
                  <line x1="80" y1="60" x2="130" y2="80" stroke="#78d870" strokeWidth="1.5" opacity="0.6"/>
                  <line x1="80" y1="60" x2="35" y2="90" stroke="#78d870" strokeWidth="1.5" opacity="0.6"/>
                  <line x1="40" y1="30" x2="15" y2="15" stroke="#78d870" strokeWidth="1" opacity="0.3"/>
                  <line x1="125" y1="25" x2="150" y2="10" stroke="#78d870" strokeWidth="1" opacity="0.3"/>
                  <circle cx="80" cy="60" r="14" fill="#78d870"/>
                  <circle cx="40" cy="30" r="10" fill="white" stroke="#78d870" strokeWidth="1.5"/>
                  <circle cx="125" cy="25" r="10" fill="white" stroke="#78d870" strokeWidth="1.5"/>
                  <circle cx="130" cy="80" r="9" fill="white" stroke="#6B7280" strokeWidth="1.5"/>
                  <circle cx="35" cy="90" r="9" fill="white" stroke="#6B7280" strokeWidth="1.5"/>
                  <circle cx="15" cy="15" r="6" fill="white" stroke="#78d870" strokeWidth="1" opacity="0.7"/>
                  <circle cx="150" cy="10" r="6" fill="white" stroke="#78d870" strokeWidth="1" opacity="0.7"/>
                </svg>
              </div>
            </div>

            {/* Feature 2 — Directory */}
            <div className="bg-white rounded-2xl p-6 border border-gray-100 hover:shadow-xl hover:shadow-gray-100/60 hover:-translate-y-0.5 transition-all group">
              <div className="w-11 h-11 bg-brand-green/10 rounded-xl flex items-center justify-center mb-4 group-hover:bg-brand-green transition-colors">
                <svg width="20" height="20" viewBox="0 0 18 18" fill="none">
                  <rect x="2" y="3" width="14" height="2.5" rx="1.25" fill="#78d870" className="group-hover:fill-white transition-colors"/>
                  <rect x="2" y="7.75" width="10" height="2.5" rx="1.25" fill="#78d870" opacity="0.6" className="group-hover:fill-white/70 transition-colors"/>
                  <rect x="2" y="12.5" width="12" height="2.5" rx="1.25" fill="#78d870" opacity="0.35" className="group-hover:fill-white/50 transition-colors"/>
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900 text-lg mb-2">Smart Directory</h3>
              <p className="text-sm text-gray-500 leading-relaxed mb-4">Searchable, filterable member directory with custom node types — people, orgs, events, and anything you define.</p>
              <div className="bg-brand-bg rounded-xl p-2.5 grid grid-cols-2 gap-2">
                {[
                  { name: "Sarah Chen", type: "People", initials: "SC" },
                  { name: "Acme Corp", type: "Startup", initials: "AC" },
                  { name: "GreenFund", type: "Investor", initials: "GF" },
                  { name: "Demo Day", type: "Event", initials: "DD" },
                ].map(node => (
                  <div key={node.name} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                    <div className="h-10 flex items-center justify-center bg-gray-50">
                      <Avatar name={node.name} initials={node.initials} size={24} />
                    </div>
                    <div className="px-2 py-1.5">
                      <div className="text-[9px] font-semibold text-gray-800 truncate mb-0.5">{node.name}</div>
                      <div className="inline-flex px-1.5 py-0.5 rounded-full bg-brand-green/10 text-brand-dark-green text-[7px] font-semibold">{node.type}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Feature 3 — AI Search */}
            <div className="bg-white rounded-2xl p-6 border border-gray-100 hover:shadow-xl hover:shadow-gray-100/60 hover:-translate-y-0.5 transition-all group">
              <div className="w-11 h-11 bg-brand-green/10 rounded-xl flex items-center justify-center mb-4 group-hover:bg-brand-green transition-colors">
                <svg width="20" height="20" viewBox="0 0 18 18" fill="none">
                  <circle cx="7.5" cy="7.5" r="5" stroke="#78d870" strokeWidth="1.5" className="group-hover:stroke-white transition-colors"/>
                  <line x1="11.5" y1="11.5" x2="16" y2="16" stroke="#78d870" strokeWidth="2" strokeLinecap="round" className="group-hover:stroke-white transition-colors"/>
                  <circle cx="7.5" cy="7.5" r="2" fill="#78d870" opacity="0.4" className="group-hover:fill-white/50 transition-colors"/>
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900 text-lg mb-2">AI Semantic Search</h3>
              <p className="text-sm text-gray-500 leading-relaxed mb-4">Ask questions in plain English. &quot;Find climate investors&quot; or &quot;founders from Stanford&quot; — it just works.</p>
              <div className="bg-brand-bg rounded-xl p-2.5 space-y-2">
                <div className="bg-white rounded-full px-3 py-2 flex items-center gap-2 border border-gray-100">
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><circle cx="5" cy="5" r="4" stroke="#9CA3AF" strokeWidth="1.2"/><line x1="8" y1="8" x2="11" y2="11" stroke="#9CA3AF" strokeWidth="1.2" strokeLinecap="round"/></svg>
                  <span className="text-[10px] text-gray-300">climate tech investors…</span>
                </div>
                <div className="space-y-1">
                  {["John Smith · Sequoia","GreenFund Partners","EV Ventures LP"].map(r => (
                    <div key={r} className="flex items-center gap-2 bg-white rounded-lg px-2.5 py-1.5 border border-gray-100">
                      <span className="w-1.5 h-1.5 rounded-full bg-brand-green shrink-0"/>
                      <span className="text-[9px] text-gray-600">{r}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Second row */}
          <div className="grid md:grid-cols-2 gap-5 mt-5">
            <div className="bg-white rounded-2xl p-6 border border-gray-100 hover:shadow-xl hover:shadow-gray-100/60 hover:-translate-y-0.5 transition-all group">
              <div className="w-11 h-11 bg-brand-green/10 rounded-xl flex items-center justify-center mb-4 group-hover:bg-brand-green transition-colors">
                <svg width="20" height="20" viewBox="0 0 18 18" fill="none">
                  <rect x="1" y="1" width="7" height="7" rx="1.5" fill="#78d870" className="group-hover:fill-white transition-colors"/>
                  <rect x="10" y="1" width="7" height="7" rx="1.5" fill="#78d870" opacity="0.6" className="group-hover:fill-white/70 transition-colors"/>
                  <rect x="1" y="10" width="7" height="7" rx="1.5" fill="#78d870" opacity="0.4" className="group-hover:fill-white/50 transition-colors"/>
                  <rect x="10" y="10" width="7" height="7" rx="1.5" fill="#78d870" opacity="0.2" className="group-hover:fill-white/30 transition-colors"/>
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900 text-lg mb-2">Multi-Community</h3>
              <p className="text-sm text-gray-500 leading-relaxed">Manage multiple communities from one account. Each has its own isolated graph, members, and custom node types — perfect for operators running multiple cohorts or programs.</p>
            </div>
            <div className="bg-white rounded-2xl p-6 border border-gray-100 hover:shadow-xl hover:shadow-gray-100/60 hover:-translate-y-0.5 transition-all group">
              <div className="w-11 h-11 bg-brand-green/10 rounded-xl flex items-center justify-center mb-4 group-hover:bg-brand-green transition-colors">
                <svg width="20" height="20" viewBox="0 0 18 18" fill="none">
                  <path d="M9 2.5C5.96 2.5 3.5 4.96 3.5 8c0 1.3.46 2.49 1.22 3.42L3.5 15.5l4.08-1.22A5.48 5.48 0 009 14.5c3.04 0 5.5-2.46 5.5-5.5S12.04 2.5 9 2.5z" stroke="#78d870" strokeWidth="1.4" className="group-hover:stroke-white transition-colors"/>
                  <circle cx="7" cy="8.5" r="0.8" fill="#78d870" className="group-hover:fill-white transition-colors"/>
                  <circle cx="9" cy="8.5" r="0.8" fill="#78d870" className="group-hover:fill-white transition-colors"/>
                  <circle cx="11" cy="8.5" r="0.8" fill="#78d870" className="group-hover:fill-white transition-colors"/>
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900 text-lg mb-2">Events & Messaging</h3>
              <p className="text-sm text-gray-500 leading-relaxed">Built-in event management with RSVP tracking, plus direct and group messaging. Everything in one place — no Mailchimp, no Slack integrations, no cobbled-together stack.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Your network, visualized ── */}
      <section className="py-24 px-6 bg-white relative overflow-hidden">
        {/* Subtle gradient accent */}
        <div className="pointer-events-none absolute right-0 top-0 w-[400px] h-[400px] bg-brand-green/5 blur-[100px] rounded-full" />

        <div className="max-w-6xl mx-auto relative">
          <div className="text-center mb-12">
            <h2 className="text-4xl lg:text-5xl font-bold text-gray-900 font-ginto mb-3 tracking-tight">
              Your network, <span className="text-brand-green italic">visualized</span>
            </h2>
            <p className="text-gray-500 max-w-lg mx-auto text-lg">Switch between grid, table, and graph — every view is connected to the same living data.</p>
          </div>

          {/* Large app mockup */}
          <div className="bg-brand-bg rounded-2xl shadow-2xl shadow-black/[0.06] border border-gray-200/50 overflow-hidden">
            <div className="bg-white border-b border-gray-100 px-5 py-3 flex items-center gap-3">
              <div className="flex gap-2">
                <div className="w-3 h-3 rounded-full bg-red-400"/>
                <div className="w-3 h-3 rounded-full bg-yellow-400"/>
                <div className="w-3 h-3 rounded-full bg-green-400"/>
              </div>
              <div className="bg-brand-bg rounded-lg px-3 py-1 text-[10px] text-gray-400 border border-gray-100 w-52">visvine.com/directory</div>
            </div>
            <div className="bg-brand-bg border-b border-gray-100 px-6 h-14 flex items-center gap-6">
              <span className="text-xl font-bold text-brand-green font-ginto">Visvine</span>
              <div className="flex items-center gap-2 bg-white rounded-full px-2.5 py-1 text-[10px] text-gray-500 border border-gray-200/60">
                <span>Founders Network</span>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2.5 4L5 6.5L7.5 4" stroke="#9CA3AF" strokeWidth="1.2"/></svg>
              </div>
              <div className="flex-1 bg-white rounded-full px-4 py-1.5 text-[10px] text-gray-300 border border-gray-100 max-w-sm">Search or ask anything…</div>
              <Avatar name="Jane Doe" initials="JD" size={32} />
            </div>
            <div className="p-6">
              <div className="flex items-center justify-between mb-3">
                <span className="text-2xl font-bold text-gray-900 font-ginto">Directory</span>
                <div className="flex items-center gap-1 bg-white rounded-full p-0.5 border border-gray-200/60 shadow-sm">
                  {[
                    { label: "⊞", active: true },
                    { label: "≡", active: false },
                    { label: "⬡", active: false },
                  ].map((v, i) => (
                    <div key={i} className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${v.active ? "bg-brand-green/15 text-brand-dark-green" : "text-gray-400"}`}>
                      {v.label}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 mb-4">
                {["Type ↓","Tag ↓","A → Z"].map(f => (
                  <div key={f} className="bg-white border border-gray-200/60 rounded-full px-3 py-1 text-[11px] text-gray-500 font-medium shadow-sm">{f}</div>
                ))}
              </div>

              {/* Directory grid with headshot avatars */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { name: "Sarah Chen", type: "People", subtitle: "Founder & CEO", initials: "SC" },
                  { name: "Acme Corp", type: "Startup", subtitle: "B2B SaaS · Seed", initials: "AC" },
                  { name: "Demo Day '25", type: "Event", subtitle: "Spring cohort", initials: "DD" },
                  { name: "John Park", type: "People", subtitle: "Partner at GV", initials: "JP" },
                  { name: "GreenFund", type: "Investor", subtitle: "Climate · A", initials: "GF" },
                  { name: "Cohort III", type: "Group", subtitle: "24 members", initials: "C3" },
                ].map((node) => (
                  <div key={node.name} className="bg-white rounded-xl border border-gray-100 overflow-hidden shadow-sm">
                    <div className="h-[72px] flex items-center justify-center bg-gray-50">
                      <Avatar name={node.name} initials={node.initials} size={36} />
                    </div>
                    <div className="p-2.5">
                      <div className="text-[10px] font-semibold text-gray-900 leading-tight mb-1 truncate">{node.name}</div>
                      <div className="inline-flex px-1.5 py-0.5 rounded-full bg-brand-green/10 text-brand-dark-green text-[8px] font-semibold mb-1">
                        {node.type}
                      </div>
                      <div className="text-[8px] text-gray-400 leading-tight truncate h-[14px]">{node.subtitle}</div>
                      <div className="flex gap-1 mt-2 pt-2 border-t border-gray-100">
                        <div className="flex-1 rounded-full border border-gray-200 text-[8px] text-gray-500 text-center py-0.5">Invite</div>
                        <div className="flex-1 rounded-full bg-brand-green text-white text-[8px] text-center py-0.5 font-medium">Message</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how-it-works" className="py-24 px-6 bg-brand-bg relative overflow-hidden">
        <div className="pointer-events-none absolute left-0 bottom-0 w-[300px] h-[300px] bg-brand-green/5 blur-[100px] rounded-full" />

        <div className="max-w-5xl mx-auto relative">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 bg-brand-green/10 text-brand-dark-green text-xs font-semibold px-4 py-2 rounded-full mb-4">
              HOW IT WORKS
            </div>
            <h2 className="text-4xl lg:text-5xl font-bold text-gray-900 font-ginto mb-3 tracking-tight">
              Up and running in <span className="text-brand-green italic">minutes</span>
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-10">
            {[
              { step: "01", title: "Create your community", desc: "Set up your workspace, define custom node types — people, orgs, events — and invite your first members in minutes." },
              { step: "02", title: "Add nodes & links", desc: "Import from a spreadsheet or add manually. Connect nodes with typed relationships that capture your network's real structure." },
              { step: "03", title: "Explore & discover", desc: "Navigate your living graph, use AI search to find hidden connections, and share insights across your community." },
            ].map(item => (
              <div key={item.step} className="relative">
                <div className="text-7xl font-bold text-brand-green/10 font-ginto mb-3 select-none">{item.step}</div>
                <h3 className="font-semibold text-gray-900 text-lg mb-2">{item.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="py-24 px-6 bg-white relative overflow-hidden">
        <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-0 w-[600px] h-[300px] bg-brand-green/5 blur-[100px] rounded-full" />

        <div className="max-w-5xl mx-auto text-center relative">
          <div className="inline-flex items-center gap-2 bg-brand-green/10 text-brand-dark-green text-xs font-semibold px-4 py-2 rounded-full mb-4">
            PRICING
          </div>
          <h2 className="text-4xl lg:text-5xl font-bold text-gray-900 font-ginto mb-3 tracking-tight">
            Simple, <span className="text-brand-green italic">transparent</span> pricing
          </h2>
          <p className="text-gray-500 mb-12 text-lg">Start free. Scale as your community grows.</p>
          <div className="grid md:grid-cols-3 gap-5">
            {[
              { name: "Starter", price: "Free", desc: "Perfect for getting started", features: ["1 community","Up to 100 nodes","Graph view","Member directory"], cta: "Get started", highlight: false },
              { name: "Growth", price: "$29", desc: "For active communities", features: ["5 communities","Up to 1,000 nodes","AI semantic search","Events & messaging","Custom node types"], cta: "Join waitlist", highlight: true },
              { name: "Scale", price: "$99", desc: "For network operators", features: ["Unlimited communities","Unlimited nodes","Priority support","CSV import/export","API access"], cta: "Join waitlist", highlight: false },
            ].map(tier => (
              <div key={tier.name} className={`rounded-2xl p-6 border text-left transition-all hover:-translate-y-0.5 ${tier.highlight ? "border-brand-green bg-brand-green/[0.03] ring-2 ring-brand-green/15 shadow-lg shadow-brand-green/5" : "border-gray-100 bg-white hover:shadow-lg hover:shadow-gray-100/60"}`}>
                {tier.highlight && <div className="text-[10px] font-bold text-brand-dark-green bg-brand-green/15 px-2.5 py-0.5 rounded-full inline-block mb-3">MOST POPULAR</div>}
                <div className="font-semibold text-gray-900 mb-1 font-ginto text-lg">{tier.name}</div>
                <div className="flex items-baseline gap-1 mb-1">
                  <span className="text-4xl font-bold text-gray-900 font-ginto">{tier.price}</span>
                  {tier.price !== "Free" && <span className="text-gray-400 text-sm">/mo</span>}
                </div>
                <div className="text-sm text-gray-400 mb-6">{tier.desc}</div>
                <ul className="space-y-2.5 mb-6">
                  {tier.features.map(f => (
                    <li key={f} className="flex items-center gap-2.5 text-sm text-gray-600">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
                        <circle cx="8" cy="8" r="8" fill="#78d870" opacity="0.12"/>
                        <path d="M5 8L7 10L11 6" stroke="#2f7a3e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
                <button onClick={() => setModalOpen(true)} className={`w-full text-center text-sm font-semibold py-3 rounded-full transition-all ${tier.highlight ? "bg-brand-green text-white hover:brightness-105 shadow-sm shadow-brand-green/25" : "border border-gray-200 text-gray-700 hover:bg-gray-50"}`}>
                  {tier.cta}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="py-24 px-6 bg-brand-bg relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[300px] bg-brand-green/5 blur-[100px] rounded-full" />
        <div className="max-w-2xl mx-auto text-center relative">
          <h2 className="text-4xl lg:text-5xl font-bold text-gray-900 font-ginto mb-4 tracking-tight">
            Ready to map your <span className="text-brand-green italic">network</span>?
          </h2>
          <p className="text-gray-500 text-lg mb-8">Join hundreds of community builders using Visvine to visualize, manage, and grow their networks.</p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => setModalOpen(true)}
              className="h-12 flex items-center px-8 rounded-full bg-brand-green text-white font-semibold text-sm hover:brightness-105 transition-all shadow-lg shadow-brand-green/25"
            >
              Get Early Access
            </button>
            <Link
              href="/signin"
              className="h-12 flex items-center gap-2 rounded-full border border-gray-200 bg-white text-gray-600 text-sm font-medium px-6 hover:border-gray-300 hover:shadow-sm transition-all"
            >
              Log in →
            </Link>
          </div>
          <p className="text-xs text-gray-400 mt-4">Free during beta. No credit card required.</p>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-white border-t border-gray-200/40 px-6 py-12">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-10 mb-10">
            <div className="col-span-2 md:col-span-1">
              <span className="text-2xl font-bold text-brand-green font-ginto block mb-3">Visvine</span>
              <p className="text-sm text-gray-400 leading-relaxed max-w-[200px]">The community platform built for the people who build networks.</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">Product</p>
              <ul className="space-y-3">
                {["Features", "Pricing", "Changelog", "Roadmap"].map(l => (
                  <li key={l}><a href="#" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">{l}</a></li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">Company</p>
              <ul className="space-y-3">
                {["About", "Blog", "Careers", "Contact"].map(l => (
                  <li key={l}><a href="#" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">{l}</a></li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">Legal</p>
              <ul className="space-y-3 mb-6">
                {["Privacy Policy", "Terms of Service"].map(l => (
                  <li key={l}><a href="#" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">{l}</a></li>
                ))}
              </ul>
              <div className="flex gap-3">
                <a href="#" aria-label="LinkedIn" className="w-9 h-9 rounded-full bg-gray-50 border border-gray-200/60 flex items-center justify-center text-gray-400 hover:text-gray-900 hover:border-gray-300 transition-all">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6zM2 9h4v12H2z"/>
                    <circle cx="4" cy="4" r="2"/>
                  </svg>
                </a>
                <a href="#" aria-label="Instagram" className="w-9 h-9 rounded-full bg-gray-50 border border-gray-200/60 flex items-center justify-center text-gray-400 hover:text-gray-900 hover:border-gray-300 transition-all">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
                    <circle cx="12" cy="12" r="4"/>
                    <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor"/>
                  </svg>
                </a>
                <a href="#" aria-label="X" className="w-9 h-9 rounded-full bg-gray-50 border border-gray-200/60 flex items-center justify-center text-gray-400 hover:text-gray-900 hover:border-gray-300 transition-all">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                  </svg>
                </a>
              </div>
            </div>
          </div>
          <div className="border-t border-gray-100 pt-6 flex flex-col md:flex-row items-center justify-between gap-2">
            <p className="text-xs text-gray-400">&copy; 2026 Visvine. All rights reserved.</p>
            <p className="text-xs text-gray-300">Made for community builders everywhere.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
