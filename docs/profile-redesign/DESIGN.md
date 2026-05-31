# Visvine — Person Profile Redesign

A redesign of the full-screen person profile (`apps/web/components/profile/ProfilePageContent.tsx`),
grounded in the real `Person` schema and the app's existing design tokens.

**Deliverables in this folder**
- [`profile-redesign.html`](./profile-redesign.html) — a self-contained, openable demo of the new design (no build step; just open it). Includes a Visitor⇄Owner toggle and the 8 theme palettes.
- This document — schema analysis, research synthesis, the design plan, the field-by-field mapping, and a drop-in **production React component** (`ProfilePageContentV2`).

---

## 1. Schema analysis — what we actually have to work with

The profile is a `Person` row (`apps/web/prisma/schema.prisma`) joined with its graph `Node`
and some derived network counts (`useNodeProfile`). Every field below is surfaced in the redesign.

| Field | Type | Meaning | Notes |
|---|---|---|---|
| `name` | string (req) | Display name | Primary identity |
| `subtitle` | string? | Headline / role | e.g. "Senior Product Designer · ex-Figma" |
| `pronouns` | string? | she/her, they/them | Inline next to name |
| `bio` | string? | Long free text | Multi-paragraph; needs read-more |
| `location` | string? | City / region | Hero meta + rail |
| `website` | string? | URL | Hero meta + rail + socials |
| `linkedinUrl` | string? | URL | Contact + socials |
| `twitterUrl` | string? | URL | Contact + socials |
| `phone` | string? | Phone | Contact (owner/connected only) |
| `email` | string? | Email | Contact (owner/connected only) |
| `openToWork` | boolean | Availability status | Avatar badge + status pill |
| `imageUrl` | string? | Avatar photo | Falls back to initials block |
| `tags` | string[] | **Skills / expertise** | First-class "Skills" section |
| `node.type` | string | e.g. "People" | Category badge |
| `node.alias` | string? | Sub-category label | Secondary badge |
| `metadata.themeColor` | enum (8) | User accent | Drives the **entire page** accent |
| `createdAt` | datetime | Joined date | "Member since" stat + rail |
| `connectionCount` | number (derived) | Network size | Social-proof stat |
| `communityCount` | number (derived) | Shared communities | Social-proof stat + rail |
| `connections[]` | array (derived) | Avatars + names | "Network" section |
| mutuals | derived | Shared connections | Visitor-only "how you're connected" |

Two viewer roles drive conditional UI:
- **Owner** (`session.user.nodeId === nodeId`) — inline edit affordances, a profile-strength meter, the theme-color picker, and "+ add" prompts for empty fields.
- **Visitor** — Connect / Message / Request-intro CTAs, a "how you're connected / mutuals" card, and a private "My Insights" (CRM) section below the fold.

---

## 2. Research synthesis — patterns from best-in-class profiles

I studied how eight modern products structure a profile, and pulled the patterns that fit a
graph-networking product. (Corroborated by a parallel multi-source research pass; see §7.)

**LinkedIn** — *the canonical professional profile.*
- Cover photo + **overlapping circular avatar**; the face anchors the page before the name.
- An "intro card" that stacks name → headline → location → current/▸past → contact link.
- **Open-to-work** is a green ring around the avatar — a status that's visible at a glance.
- A **sticky profile sub-nav** (About / Activity / Experience / Skills) appears on scroll so long profiles stay navigable.
- "Highlights" surfaces *mutual* connections — social proof tuned to the viewer.
- *Take:* cover+avatar hero, intro stack, open-to-work as an avatar badge, sticky sub-nav, mutuals.

**GitHub** — *identity rail + wide content.*
- A **narrow left rail** (avatar, name, bio, org, location, links, follower counts) sits beside a wide content column. Asymmetry = hierarchy.
- Followers/following as plain, trustworthy **numbers**.
- *Take:* sticky right rail of "at a glance" facts + a wide main column.

**X / Twitter** — *banner + dense identity.*
- Banner with an **overlapping avatar**; name + handle; a single **inline metadata row** (location · link · joined date) that's quietly scannable.
- Follower/following **counts as the primary social proof**.
- A **condensed sticky header** (name + count) appears on scroll.
- *Take:* inline meta row, stat strip as social proof, sticky condensed nav.

**Behance / Dribbble** — *work-first creative profiles.*
- **Skills/tools are a first-class section**, not an afterthought; an **"available for work"** pill is prominent.
- Big stat numbers (appreciations, views, followers).
- *Take:* promote `tags` to a prominent **Skills & expertise** section; make `openToWork` a real status.

**read.cv / Polywork / about.me** — *typography-forward personal sites.*
- Generous whitespace, strong type hierarchy, a **"status / now" line**, sectioned content.
- A **personal accent color** themes the page.
- *Take:* lean on the display font for the name/headers; let `metadata.themeColor` drive the whole page.

**Figma Community** — *clean, follow-centric.*
- Avatar + name + follow, minimal chrome, resource grid, follower stats.
- *Take:* keep chrome quiet; let content + accent carry the page.

**Notion / Linear member profiles** — *quiet app-member identity.*
- Avatar, name, role, **key/value contact rows**, teams; restrained typography; **hover/peek** cards.
- *Take:* the rail's "at a glance" key/value list; quiet contact rows.

**Slack / Discord member panels** — *compact identity with presence.*
- Avatar with a **presence/status ring**, **pronouns**, role badges, about-me, member-since, quick actions (message/call), an **accent banner**.
- *Take:* pronouns inline, accent cover banner, quick-action buttons, status badge.

### The throughline
Every strong profile does the same four things in order: **(1) establish identity** (face, name, one-line who-and-where), **(2) prove credibility** (numbers, mutuals, status), **(3) tell the story** (about, skills), **(4) enable action** (connect, contact). The current Visvine design flattens 2–4 into an equal-weight grid and skips the identity *moment* entirely. The redesign restores that order.

---

## 3. Design plan

### Information hierarchy
1. **Primary — Identity:** cover band (accent) + overlapping avatar, name + pronouns, type/alias badges, headline, location · website · joined inline, open-to-work status, primary actions.
2. **Secondary — Credibility:** stat strip (connections / communities / mutual / member-since); for visitors, a "how you're connected" mutuals card.
3. **Tertiary — Substance:** About (bio), Skills (tags), Network (connections).
4. **Supporting — Reach:** contact + social links in the rail; My Insights (private CRM) below for visitors.

### Layout
```
┌──────────────────────────────────────────────────────────┐
│  COVER  (accent gradient · owner: theme/share/edit)       │
├──────────────────────────────────────────────────────────┤
│  ◐ avatar (overlaps cover)                                │
│  badges · Name (pronouns) · headline                      │
│  location · website · joined · [open to work]             │
│  [Connect] [Message] [Request intro]   ← visitor          │
│  248 Connections · 5 Communities · 32 Mutual · 2023       │
├──────────────────────────────────────────────────────────┤
│  About · Skills · Network · Contact      ← sticky sub-nav │
├───────────────────────────────────┬──────────────────────┤
│  MAIN (1fr)                        │  RAIL (320px, sticky)│
│  ▸ About (bio, read-more)          │  ▸ At a glance       │
│  ▸ Skills & expertise (tags)       │  ▸ Mutuals (visitor) │
│  ▸ Network (connection grid)       │    / Strength (owner)│
│                                    │  ▸ Contact + socials │
└───────────────────────────────────┴──────────────────────┘
```
- **Cover + overlapping avatar** gives the identity moment the old design lacked.
- **Asymmetric main + sticky rail** (GitHub/LinkedIn) replaces the flat equal 2-column grid.
- **Sticky in-page sub-nav** with scroll-spy keeps long profiles navigable (LinkedIn/X).

### Field → placement → treatment
| Field | Placement | Treatment |
|---|---|---|
| `imageUrl` | Hero, overlapping cover | 148px rounded-26 photo, accent ring; initials fallback |
| `openToWork` | Avatar badge + meta pill | accent status badge + pulsing dot |
| `name` | Hero | 30px display, weight 800 |
| `pronouns` | Beside name | muted 14px |
| `node.type` / `node.alias` | Above name | accent badge + neutral badge |
| `subtitle` | Below name | 16px secondary, max 60ch |
| `location` `website` `createdAt` | Meta row + rail | icon + text; website linkified |
| `connectionCount` etc. | Stat strip | big display numbers, hover→accent |
| `bio` | About card | 15px/1.7, read-more past ~230 chars |
| `tags` | Skills card | accent-tinted chips, hover lift |
| `connections[]` | Network card | avatar+name cards in auto-fill grid |
| mutuals | Rail (visitor) | overlapping avatar stack + count |
| `email` `phone` `linkedinUrl` `twitterUrl` `website` | Contact card | rows + social icon buttons |
| `metadata.themeColor` | Whole page | CSS accent vars; owner picker on cover |

### Owner vs visitor
- **Owner:** Edit profile / Preview-as-visitor / Share / Theme; per-section Edit + Add affordances; profile-strength meter (folds in the completion banner); empty fields show dashed "+ Add …" prompts.
- **Visitor:** Connect (primary) / Message / Request intro; mutuals card; empty fields are hidden or shown as a muted "No … yet"; My Insights (private CRM) below the fold.

### Empty states
Owner → actionable dashed prompts ("+ Add a bio"). Visitor → the section is omitted or a single muted italic line. The hero never collapses: name + avatar (initials) + type badge always render.

### Responsive
- **≥880px:** main + 320px sticky rail.
- **560–880px:** rail drops beneath the main column.
- **<560px:** single column, sheet goes edge-to-edge, avatar centers, CTAs stretch full-width, stat strip wraps, sub-nav scrolls horizontally.

### Accessibility & theming
- **Anchor-nav, not a tablist.** The sticky sub-nav is a labelled `<nav>` of in-page `<a>`/`<button>` jumps with scroll-spy + `aria-current` — *not* a re-used `role="tab"` tablist. (Repurposing a real tablist as a single-document scroll-spy is an a11y regression: `aria-selected` lies and arrow-key focus desyncs from the viewport.)
- **Contrast is derived, not assumed.** Each palette ships a hand-tuned `dark` variant used only for *text on its own `light` tint* (e.g. `#2f7a3e` on `#eaf9ec`). For the `hexToPalette` *system fallback*, production should compute an `onAccent` foreground (WCAG-checked black/white) rather than trusting `darkenHex(...)` to clear 4.5:1 on every community color — small chip text is the risk surface.
- **Accent is rationed.** The accent appears in a fixed, deliberate set (cover, avatar ring, primary CTA, active sub-nav underline, skill chips, stat hover, focus ring). Everything else is monochrome so a saturated palette reads as *identity*, not decoration. `openToWork` is the one rationed *semantic* color (and never color-only — it always pairs an icon + text).
- **One nudge at a time (owner).** A nudge budget caps owner prompts: show *either* the rail strength meter *or* a floating ring, never both, and damp per-section "+ Add" prompts once the global meter is visible — so a sparse owner profile reads as "a profile with prompts," not a wall of dashed boxes.
- Icon-only buttons carry `aria-label`; tap targets ≥44px; `:focus-visible` rings in the accent; `prefers-reduced-motion` disables the pulse, the underline transition, and smooth-scroll (falls back to instant).
- **Avoid the theme flash.** `profile` (theme color) and `nodeData` load from separate caches. To avoid a full-page accent repaint when `metadata.themeColor` arrives after the system fallback already painted, gate the themed surfaces on `profile` resolving (or paint neutral until both halves are in). The component derives `theme` synchronously from whichever is present and should hold the cover/ring/CTA until the saved color is known.

### Key improvements over the current design
1. A real **identity moment** (cover + overlapping avatar) instead of a bare square.
2. **Hierarchy via asymmetry** (main + rail) instead of an equal 2-col grid.
3. **Scroll-spy sticky sub-nav** for navigability.
4. **Skills promoted** to a first-class, scannable section.
5. **Viewer-aware**: distinct, purposeful owner vs visitor surfaces (incl. mutuals + strength meter).
6. **Cohesive theming**: one accent drives cover, ring, badges, chips, stats, and focus.

---

## 4. Production React component

`ProfilePageContentV2` is a drop-in replacement for `ProfilePageContent`. It reuses the existing
hooks (`useProfile`, `useNodeProfile`, `useSession`, `useCommunity`), the theme derivation, the
`lucide-react` icon set, the `FullProfile`/`NodeProfileData` types, and the existing edit modals —
so it slots into the app with no API changes. (Kept here as reference rather than wired in, so it
doesn't alter the live route until you choose to swap it.)

```tsx
'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  MapPin, ExternalLink, Linkedin, Twitter, Phone, Mail, Globe2, Calendar,
  Pencil, Plus, Share2, Users, Building2, Sparkles, Wrench, Network as NetworkIcon,
  CheckCircle2, Eye, Palette, ChevronDown, ChevronUp,
} from 'lucide-react';
import Image from 'next/image';
import { useProfile } from '@/hooks/useProfile';
import { useNodeProfile } from '@/hooks/useNodeProfile';
import { useSession } from '@/lib/auth-client';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { getPalette, hexToPalette, type ThemePalette } from '@/lib/profileTheme';
import { getNodeTypeConfig } from '@/lib/types';
import { getInitials } from '@/lib/avatarUtils';
import { computeProfileCompletion } from '@/lib/profileTypes';
import ProfileSkeletonLoader from './ProfileSkeletonLoader';
import MyInsightsSection from './MyInsightsSection';
import EditBasicInfoModal from './edit/EditBasicInfoModal';
import EditAboutModal from './edit/EditAboutModal';
import EditSkillsModal from './edit/EditSkillsModal';
import EditContactModal from './edit/EditContactModal';

type ModalState = 'basicInfo' | 'about' | 'skills' | 'contact' | null;
const SECTIONS = ['about', 'skills', 'network', 'contact'] as const;
type Section = typeof SECTIONS[number];

const hostname = (url?: string | null) => {
  if (!url) return '';
  try { return new URL(url).hostname.replace('www.', ''); } catch { return url; }
};

/** Accent CSS custom properties, so one palette themes the whole subtree. */
function accentVars(t: ThemePalette): React.CSSProperties {
  return {
    // consumed via inline style below; kept explicit for clarity
    ['--accent' as string]: t.base,
    ['--accent-light' as string]: t.light,
    ['--accent-dark' as string]: t.dark,
  };
}

/** Scroll-spy for the sticky sub-nav. */
function useScrollSpy(ids: readonly string[]) {
  const [active, setActive] = useState<string>(ids[0]);
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) setActive(e.target.id); }),
      { rootMargin: '-20% 0px -70% 0px' },
    );
    ids.forEach((id) => { const el = document.getElementById(id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [ids]);
  return active;
}

export default function ProfilePageContentV2({ nodeId }: { nodeId: string }) {
  const { data: session } = useSession();
  const { currentCommunity } = useCommunity();
  const { profile, loading, error, updateBasicInfo } = useProfile(nodeId);
  const { data: nodeData } = useNodeProfile(nodeId);
  const [modal, setModal] = useState<ModalState>(null);
  const active = useScrollSpy(SECTIONS);

  const isOwner = !!(session?.user?.nodeId && session.user.nodeId === nodeId);

  const systemPalette = useMemo(() => {
    const nodeType = nodeData?.node?.type ?? 'People';
    return hexToPalette(getNodeTypeConfig(nodeType, currentCommunity?.nodeTypes).color);
  }, [nodeData?.node?.type, currentCommunity?.nodeTypes]);
  const savedThemeId = profile?.metadata?.themeColor as string | undefined;
  const theme = savedThemeId ? getPalette(savedThemeId) : systemPalette;

  if (loading) return <ProfileSkeletonLoader mode="fullpage" />;
  if (error || !profile) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3 text-center">
        <div className="text-5xl">😕</div>
        <p className="text-base font-semibold text-text-primary">Profile not found</p>
        <p className="text-sm text-text-muted">This person may have been removed or the URL is incorrect.</p>
      </div>
    );
  }

  const connectionCount = nodeData?.connectionCount ?? 0;
  const communityCount = nodeData?.communityCount ?? 1;
  const connections = nodeData?.connections ?? [];
  const memberYear = profile.createdAt ? new Date(profile.createdAt).getFullYear() : null;
  const { score } = computeProfileCompletion(profile);
  const hasContact = !!(profile.email || profile.phone || profile.website || profile.linkedinUrl || profile.twitterUrl);

  const jump = (id: Section) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div style={accentVars(theme)}>
      {/* ── COVER ── */}
      <div
        className="relative h-44 sm:h-48"
        style={{ background: `linear-gradient(120deg, ${theme.base}, ${theme.dark})` }}
      >
        <div className="absolute inset-0 opacity-30"
             style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.25) 1px, transparent 1.4px)', backgroundSize: '18px 18px' }} />
        <div className="absolute top-4 right-4 flex gap-2 z-10">
          {isOwner && (
            <button className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-black/25 text-white text-xs font-semibold backdrop-blur hover:bg-black/35 transition">
              <Palette className="w-3.5 h-3.5" /> Theme
            </button>
          )}
          <button className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-black/25 text-white text-xs font-semibold backdrop-blur hover:bg-black/35 transition">
            <Share2 className="w-3.5 h-3.5" /> Share
          </button>
        </div>
      </div>

      {/* ── HERO ── */}
      <div className="relative px-6 sm:px-8 pb-6">
        <div className="absolute -top-16 left-6 sm:left-8">
          <div className="relative">
            <div className="w-32 h-32 sm:w-36 sm:h-36 rounded-3xl overflow-hidden"
                 style={{ boxShadow: `0 0 0 5px var(--surface-1, #fff), 0 10px 30px rgba(0,0,0,.18)` }}>
              {profile.imageUrl ? (
                <Image src={profile.imageUrl} alt={profile.name} width={144} height={144} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-4xl font-bold text-white"
                     style={{ background: `linear-gradient(135deg, ${theme.base}, ${theme.dark})` }}>
                  {getInitials(profile.name)}
                </div>
              )}
            </div>
            {profile.openToWork && (
              <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 h-7 px-2.5 rounded-full text-[11px] font-bold text-white border-[3px]"
                    style={{ background: theme.dark, borderColor: 'var(--surface-1, #fff)' }}>
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" /> Open
              </span>
            )}
          </div>
        </div>

        <div className="pt-20 sm:pt-24 flex flex-col">
          {/* badges */}
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            {nodeData?.node?.type && (
              <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[11.5px] font-semibold border"
                    style={{ background: theme.light, color: theme.dark, borderColor: `${theme.base}40` }}>
                {nodeData.node.type}
              </span>
            )}
            {nodeData?.node?.alias && (
              <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[11.5px] font-semibold bg-surface-2 text-text-muted border border-border-default">
                {nodeData.node.alias}
              </span>
            )}
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <h1 className="text-2xl sm:text-3xl font-bold text-text-primary leading-tight font-ginto">{profile.name}</h1>
                {profile.pronouns && <span className="text-sm text-text-muted font-medium">{profile.pronouns}</span>}
              </div>
              {profile.subtitle ? (
                <p className="mt-1.5 text-[15px] sm:text-base text-text-secondary max-w-[60ch]">{profile.subtitle}</p>
              ) : isOwner ? (
                <button onClick={() => setModal('basicInfo')} className="mt-1.5 text-sm hover:underline" style={{ color: theme.dark }}>+ Add a headline</button>
              ) : null}

              {/* inline meta row */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-sm text-text-muted">
                {profile.location && (
                  <span className="inline-flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />{profile.location}</span>
                )}
                {profile.website && (
                  <a href={profile.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-semibold" style={{ color: theme.dark }}>
                    <Globe2 className="w-3.5 h-3.5" />{hostname(profile.website)}
                  </a>
                )}
                {memberYear && (
                  <span className="inline-flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" />Joined {memberYear}</span>
                )}
                {profile.openToWork && (
                  <span className="inline-flex items-center gap-1.5 h-6 px-3 rounded-full text-[12.5px] font-semibold border"
                        style={{ background: theme.light, color: theme.dark, borderColor: `${theme.base}80` }}>
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: theme.base }} />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: theme.base }} />
                    </span>
                    Open to work
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* actions */}
          <div className="flex flex-wrap gap-2.5 mt-4">
            {isOwner ? (
              <>
                <button onClick={() => setModal('basicInfo')} className="inline-flex items-center gap-2 h-10 px-4 rounded-full text-sm font-bold text-white" style={{ background: theme.base }}>
                  <Pencil className="w-4 h-4" /> Edit profile
                </button>
                <button className="inline-flex items-center gap-2 h-10 px-4 rounded-full text-sm font-bold bg-surface-2 text-text-secondary border border-border-default hover:bg-surface-3">
                  <Eye className="w-4 h-4" /> Preview as visitor
                </button>
              </>
            ) : (
              <>
                <button className="inline-flex items-center gap-2 h-10 px-4 rounded-full text-sm font-bold text-white active:scale-95" style={{ background: theme.base }}>
                  <Users className="w-4 h-4" /> Connect
                </button>
                <button className="inline-flex items-center gap-2 h-10 px-4 rounded-full text-sm font-bold bg-surface-1 border-[1.5px] active:scale-95" style={{ color: theme.dark, borderColor: `${theme.base}88` }}>
                  <Mail className="w-4 h-4" /> Message
                </button>
                <button className="inline-flex items-center gap-2 h-10 px-4 rounded-full text-sm font-bold bg-surface-2 text-text-secondary border border-border-default">
                  <Users className="w-4 h-4" /> Request intro
                </button>
              </>
            )}
          </div>

          {/* social-proof stats */}
          <div className="flex flex-wrap gap-6 mt-5 pt-4 border-t border-border-subtle">
            <button onClick={() => jump('network')} className="flex flex-col items-start">
              <b className="text-lg font-bold font-ginto text-text-primary">{connectionCount}</b>
              <span className="text-xs text-text-muted">Connections</span>
            </button>
            <div className="flex flex-col">
              <b className="text-lg font-bold font-ginto text-text-primary">{communityCount}</b>
              <span className="text-xs text-text-muted">Communities</span>
            </div>
            {memberYear && (
              <div className="flex flex-col">
                <b className="text-lg font-bold font-ginto text-text-primary">{memberYear}</b>
                <span className="text-xs text-text-muted">Member since</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── STICKY SUB-NAV ── */}
      <nav className="sticky top-0 z-20 flex gap-1 px-4 sm:px-6 border-b border-border-subtle bg-surface-1/85 backdrop-blur overflow-x-auto"
           aria-label="Profile sections">
        {SECTIONS.map((s) => (
          <button key={s} onClick={() => jump(s)}
                  className="relative px-3.5 py-3 text-sm font-semibold capitalize whitespace-nowrap transition"
                  style={{ color: active === s ? theme.dark : undefined }}>
            <span className={active === s ? '' : 'text-text-muted'}>{s}</span>
            {active === s && <span className="absolute left-3.5 right-3.5 bottom-0 h-[3px] rounded-t" style={{ background: theme.base }} />}
          </button>
        ))}
      </nav>

      {/* ── BODY ── */}
      <div className="px-6 sm:px-8 py-6 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
        {/* MAIN */}
        <div className="min-w-0 flex flex-col gap-5">
          {/* About */}
          <SectionCard id="about" icon={<Sparkles className="w-[18px] h-[18px]" />} title="About"
                       theme={theme} isOwner={isOwner} onEdit={() => setModal('about')}>
            {profile.bio
              ? <BioText bio={profile.bio} theme={theme} />
              : isOwner
                ? <AddPrompt theme={theme} label="Add a bio to introduce yourself" onClick={() => setModal('about')} />
                : <p className="text-sm text-text-muted italic">No bio yet.</p>}
          </SectionCard>

          {/* Skills */}
          <SectionCard id="skills" icon={<Wrench className="w-[18px] h-[18px]" />} title="Skills & expertise"
                       theme={theme} isOwner={isOwner} addLabel onEdit={() => setModal('skills')}>
            {profile.tags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {profile.tags.map((tag) => (
                  <span key={tag} className="px-3 py-1.5 rounded-full text-[13px] font-semibold border transition hover:-translate-y-0.5"
                        style={{ background: theme.light, color: theme.dark, borderColor: `${theme.base}40` }}>
                    {tag}
                  </span>
                ))}
              </div>
            ) : isOwner
              ? <AddPrompt theme={theme} label="Add skills & expertise" onClick={() => setModal('skills')} />
              : <p className="text-sm text-text-muted italic">No skills listed.</p>}
          </SectionCard>

          {/* Network */}
          {connections.length > 0 && (
            <SectionCard id="network" icon={<NetworkIcon className="w-[18px] h-[18px]" />}
                         title={`Network · ${connectionCount}`} theme={theme} isOwner={false}>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
                {connections.slice(0, 12).map((c) => (
                  <a key={c.id} href={`/directory/${encodeURIComponent(c.id)}`}
                     className="flex items-center gap-2.5 p-2.5 rounded-2xl border border-border-subtle hover:-translate-y-0.5 transition"
                     style={{ borderColor: undefined }}>
                    {c.image_url
                      ? <img src={c.image_url} alt={c.name} className="w-10 h-10 rounded-xl object-cover flex-none" />
                      : <span className="w-10 h-10 rounded-xl bg-surface-3 text-text-muted flex items-center justify-center text-sm font-bold flex-none">{getInitials(c.name)}</span>}
                    <span className="min-w-0">
                      <b className="block text-[13.5px] font-bold text-text-primary truncate">{c.name}</b>
                      {c.subtitle && <span className="block text-xs text-text-muted truncate">{c.subtitle}</span>}
                    </span>
                  </a>
                ))}
              </div>
            </SectionCard>
          )}
        </div>

        {/* RAIL */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-16 self-start">
          {/* At a glance */}
          <RailCard title="At a glance">
            <div className="flex flex-col gap-3">
              {profile.location && <KV icon={<MapPin className="w-4 h-4" />} label="Location" value={profile.location} />}
              {profile.website && <KV icon={<Globe2 className="w-4 h-4" />} label="Website" value={hostname(profile.website)} href={profile.website} theme={theme} />}
              <KV icon={<Building2 className="w-4 h-4" />} label="Communities" value={`${communityCount} shared`} />
              {profile.createdAt && <KV icon={<Calendar className="w-4 h-4" />} label="Member since"
                value={new Date(profile.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} />}
            </div>
          </RailCard>

          {/* Owner: profile strength. Visitor: would render a mutuals card. */}
          {isOwner && score < 100 && (
            <RailCard title="Profile strength">
              <div className="flex items-center gap-3">
                <div className="relative w-14 h-14 flex-none rounded-full grid place-items-center"
                     style={{ background: `conic-gradient(${theme.base} ${score}%, var(--surface-3,#f3f4f6) 0)` }}>
                  <div className="absolute w-10 h-10 rounded-full bg-surface-1" />
                  <b className="relative text-[13px] font-bold font-ginto">{score}%</b>
                </div>
                <p className="text-[13px] text-text-secondary">A few more details and you’ll rank higher in your community’s directory.</p>
              </div>
            </RailCard>
          )}

          {/* Contact */}
          <SectionCard id="contact" icon={<Mail className="w-[18px] h-[18px]" />} title="Contact"
                       theme={theme} isOwner={isOwner} onEdit={() => setModal('contact')} rail>
            {hasContact ? (
              <>
                <div className="flex flex-col gap-0.5">
                  {profile.email && <ContactRow icon={<Mail className="w-4 h-4" />} href={`mailto:${profile.email}`} text={profile.email} />}
                  {profile.phone && <ContactRow icon={<Phone className="w-4 h-4" />} href={`tel:${profile.phone}`} text={profile.phone} />}
                </div>
                <div className="flex gap-2 mt-2">
                  {profile.linkedinUrl && <SocialBtn href={profile.linkedinUrl} theme={theme} label="LinkedIn"><Linkedin className="w-[18px] h-[18px]" /></SocialBtn>}
                  {profile.twitterUrl && <SocialBtn href={profile.twitterUrl} theme={theme} label="X / Twitter"><Twitter className="w-[18px] h-[18px]" /></SocialBtn>}
                  {profile.website && <SocialBtn href={profile.website} theme={theme} label="Website"><ExternalLink className="w-[18px] h-[18px]" /></SocialBtn>}
                </div>
              </>
            ) : isOwner
              ? <AddPrompt theme={theme} label="Add contact info" onClick={() => setModal('contact')} />
              : <p className="text-sm text-text-muted italic">No contact info listed.</p>}
          </SectionCard>
        </div>
      </div>

      {/* Visitor-only private CRM notes */}
      {!isOwner && <MyInsightsSection nodeId={nodeId} communityId={currentCommunity?.id} />}

      {/* Modals (unchanged) */}
      {modal === 'basicInfo' && <EditBasicInfoModal open onClose={() => setModal(null)} profile={profile} onSave={updateBasicInfo} />}
      {modal === 'about' && <EditAboutModal open onClose={() => setModal(null)} bio={profile.bio} onSave={updateBasicInfo} />}
      {modal === 'skills' && <EditSkillsModal open onClose={() => setModal(null)} tags={profile.tags} onSave={updateBasicInfo} />}
      {modal === 'contact' && <EditContactModal open onClose={() => setModal(null)} profile={profile} onSave={updateBasicInfo} />}
    </div>
  );
}

/* ── small presentational helpers ─────────────────────────────────────────── */

function SectionCard({ id, icon, title, theme, isOwner, onEdit, addLabel, rail, children }: {
  id: string; icon: React.ReactNode; title: string; theme: ThemePalette;
  isOwner: boolean; onEdit?: () => void; addLabel?: boolean; rail?: boolean; children: React.ReactNode;
}) {
  return (
    <section id={id} className="bg-surface-1 border border-border-subtle rounded-2xl shadow-soft scroll-mt-16">
      <div className="flex items-center justify-between px-5 pt-4 pb-2.5">
        <h2 className="flex items-center gap-2 text-[15px] font-bold font-ginto text-text-primary">
          <span style={{ color: theme.dark }}>{icon}</span>{title}
        </h2>
        {isOwner && onEdit && (
          <button onClick={onEdit} className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[13px] font-semibold text-text-muted hover:text-text-primary hover:bg-surface-2">
            {addLabel ? <Plus className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}{addLabel ? 'Add' : 'Edit'}
          </button>
        )}
      </div>
      <div className={`px-5 ${rail ? 'pb-4 pt-1' : 'pb-5'}`}>{children}</div>
    </section>
  );
}

function RailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-1 border border-border-subtle rounded-2xl shadow-soft px-5 py-4">
      <div className="text-[12px] font-bold uppercase tracking-wider text-text-muted mb-3.5">{title}</div>
      {children}
    </div>
  );
}

function KV({ icon, label, value, href, theme }: { icon: React.ReactNode; label: string; value: string; href?: string; theme?: ThemePalette }) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <span className="text-text-muted mt-0.5 flex-none">{icon}</span>
      <div className="min-w-0">
        <div className="text-xs text-text-muted">{label}</div>
        {href
          ? <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold truncate block" style={{ color: theme?.dark }}>{value}</a>
          : <div className="font-semibold text-text-primary">{value}</div>}
      </div>
    </div>
  );
}

function ContactRow({ icon, href, text }: { icon: React.ReactNode; href: string; text: string }) {
  return (
    <a href={href} className="flex items-center gap-3 px-2 py-2 rounded-lg text-sm text-text-secondary hover:bg-surface-2 hover:text-text-primary transition">
      <span className="text-text-muted flex-none">{icon}</span><span className="truncate">{text}</span>
    </a>
  );
}

function SocialBtn({ href, theme, label, children }: { href: string; theme: ThemePalette; label: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label}
       className="w-9 h-9 rounded-xl grid place-items-center bg-surface-2 border border-border-default text-text-secondary hover:text-[color:var(--accent-dark)] transition"
       style={{ ['--accent-dark' as string]: theme.dark }}>
      {children}
    </a>
  );
}

function AddPrompt({ theme, label, onClick }: { theme: ThemePalette; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="w-full py-4 border-[1.5px] border-dashed border-border-default rounded-xl text-sm text-text-muted hover:text-[color:var(--ad)] flex items-center justify-center gap-1.5 transition"
      style={{ ['--ad' as string]: theme.dark }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = theme.base)}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = '')}>
      <Plus className="w-4 h-4" /> {label}
    </button>
  );
}

function BioText({ bio, theme }: { bio: string; theme: ThemePalette }) {
  const [open, setOpen] = useState(false);
  const long = bio.length > 280;
  const text = long && !open ? bio.slice(0, 280).trimEnd() + '…' : bio;
  return (
    <div>
      <p className="text-[15px] text-text-secondary leading-relaxed whitespace-pre-line">{text}</p>
      {long && (
        <button onClick={() => setOpen((v) => !v)} className="mt-2 flex items-center gap-1 text-[13px] font-bold" style={{ color: theme.dark }}>
          {open ? <><ChevronUp className="w-3.5 h-3.5" /> Show less</> : <><ChevronDown className="w-3.5 h-3.5" /> Read more</>}
        </button>
      )}
    </div>
  );
}
```

> Notes: `getNodeTypeConfig` import path and the `connections[]` link target (`/directory/[id]`)
> mirror the existing `ProfilePageContent`. `EditBasicInfoModal` doubles as the "Edit profile"
> entry the way the current page already wires it. The visitor mutuals card is described in the
> plan; wire it to a `mutualConnections` source when one is available (the API already returns
> `connections[]`, so a mutuals endpoint is the only new data dependency).

---

## 5. How to view
Open [`profile-redesign.html`](./profile-redesign.html) in any browser. Use the top-right **Demo controls**
to switch **Visitor ⇄ Owner** and to try the **8 theme palettes** (these mirror `lib/profileTheme.ts`).
Scroll to watch the sticky sub-nav track the active section.

## 6. What changed vs. the current page, at a glance
| | Current | Redesign |
|---|---|---|
| Identity | bare 225px square | cover band + overlapping avatar, badges, status |
| Layout | equal 2-col grid | asymmetric main + sticky rail |
| Navigation | none | sticky scroll-spy sub-nav |
| Skills | sidebar pill cloud | first-class section |
| Viewer states | minor button swap | distinct owner (strength, edit, theme) vs visitor (mutuals, CTAs) |
| Theming | accent on chips/avatar | one accent across cover, ring, badges, chips, stats, focus |

## 7. Data reality — what ships today vs. what needs backend work

The visual design is sound, but a redesign in a *trust-centric networking product* must not put
confident-looking **fake or empty data** in prominent slots. A completeness audit + a direct read
of the route handlers turned up gaps that I **verified against the code**:

| Surface in the redesign | Backing data today | Verdict |
|---|---|---|
| `name`, `subtitle`, `pronouns`, `bio`, `tags`, `location`, `website`, `email`, `phone`, `linkedinUrl`, `twitterUrl`, `openToWork`, `imageUrl`, `metadata.themeColor` | Real — from `Person` via `/api/profile/[personId]` | ✅ **Ships now** |
| `connections[]` + count | Real, but `connectionCount = linksWithNodes.length` (`/api/nodes/[nodeId]/route.ts:80`) is the **raw, undeduped** link-row count — double links / self-loops inflate it | ⚠️ **Ships, but dedupe the count** (`COUNT(DISTINCT connected_id)`) before calling it "social proof" |
| `createdAt` → "Member since" | Real, but it's the **node row** creation time — for seeded/imported nodes (e.g. `scripts/add-nz-ecosystem.mjs`) that's an ETL date, not a join date | ⚠️ **Label honestly** ("On Visvine since") or omit for imported nodes |
| `node.alias` badge | **Not selected** by `/api/nodes/[nodeId]` (route `:25` select list omits it) → always `undefined` today | ❌ **Add to the `select`** before relying on it |
| `communityCount` / Communities | **Hardcoded `communityCount: 1`** (`/api/nodes/[nodeId]/route.ts:81`); `directory/[nodeId]/page.tsx` fabricates a community whose `name` is the raw community-ID string | ❌ **Needs a real per-node membership query** — or cut the stat |
| Mutual connections ("how you're connected") | `mutualConnections={[]}` is **hardcoded** in `FullProfileOverlay.tsx` and `directory/[nodeId]/page.tsx`; no server intersection exists | ❌ **Net-new backend** (viewer∩target, community-scoped, deduped) — or cut from v1 |
| Activity feed | **Fabricated** in `directory/[nodeId]/page.tsx` from `connections.slice(0,10)` relabeled "Connected with …" | ❌ **Not real activity** — omit until a real event source exists |
| Visitor CTA state (Connect → Pending → Connected) | `ctaState` is hardcoded `"idle"`; no relationship source wired | ❌ **Needs a relationship-state source** (the `IntroRequestModal` exists to wire intros) |

**Recommendation:** ship the redesign on the ✅/⚠️ rows now (it already beats the current page on
hierarchy and identity), and treat **mutuals**, **real communities**, **activity**, and **live CTA
state** as a *fast-follow* backed by real queries — not as hero content wired to `[]`. The demo
marks these dependent surfaces in comments. Also reconcile the two parallel data shapes
(`FullProfile` from `/api/profile` vs `NBNode` from `/api/nodes`) into one view-model so the page
isn't a third hero implementation with a third field-naming convention.

## 8. Research provenance
The pattern synthesis in §2 was produced and cross-checked by a parallel, multi-source research
pass — **8 product-specific researchers** (LinkedIn, GitHub, X, Behance/Dribbble, Figma,
Notion/Linear, read.cv/Polywork, Slack/Discord) → synthesis → an adversarial **completeness
critique**. The web-grounded specifics (e.g. LinkedIn's "intro card" + the green open-to-work
*ring*, X's inline-metadata row, GitHub's identity-rail asymmetry) and the audit's findings (§7,
plus the a11y/rationing refinements in §3) are folded into this plan. Claims the audit made about
the codebase were independently verified against the route handlers before being recorded above.
