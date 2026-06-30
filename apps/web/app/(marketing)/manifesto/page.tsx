import Link from "next/link";
import { BRAND } from "@/lib/brand";

// Shared type scales — centered statement headlines vs the left-aligned reading body.
const HEADLINE =
  "mt-16 sm:mt-20 text-center text-3xl sm:text-4xl md:text-5xl font-medium tracking-tight leading-[1.1] text-black";
const BODY = "mt-6 text-lg sm:text-xl leading-relaxed text-neutral-700";

export default function Manifesto() {
  return (
    <article className="relative z-10 mx-auto w-full max-w-2xl px-5 sm:px-8 pt-10 pb-20 sm:pt-16 sm:pb-28 text-center text-neutral-700">
      <header className="text-center">
        <h1 className="text-5xl sm:text-6xl md:text-7xl font-medium tracking-tight leading-[1.02] text-black">
          Our manifesto.
        </h1>
        <div
          className="mx-auto mt-8 h-1.5 w-24 rounded-full"
          style={{ backgroundColor: BRAND }}
          aria-hidden="true"
        />
      </header>

      <p className="mt-14 sm:mt-16 text-center text-3xl sm:text-4xl md:text-5xl font-medium tracking-tight leading-[1.1] text-black">
        Opportunity is a map most people never get to see.
      </p>

      <p className="mt-12 text-xl sm:text-2xl leading-relaxed text-neutral-800">
        Every industry, every scene, every community has a shape: a web of
        people, relationships, events, and openings that fits together into an
        ecosystem.
      </p>

      <p className={BODY}>
        The people who get the most opportunity rarely get there just by being
        the smartest or hardest-working in the room. They got there because
        someone showed them the map: the program built for people like them,
        the company that was hiring before the job was ever posted, the room
        where the real introductions happen, and the community of people who
        want to help them grow.
      </p>

      <p className={BODY}>
        This information isn&rsquo;t hidden. It isn&rsquo;t protected.
        It&rsquo;s just unorganised, scattered across cities and circles,
        living in people&rsquo;s heads, lost to neglect rather than malice. And
        the cost is real: we have watched a whole generation shape the next
        forty years of their lives while only ever seeing a fraction of the
        map, people with brilliant ideas spend years assembling a context that
        someone, somewhere, already had, and whole communities die quietly
        inside group chats nobody grew.
      </p>

      <h2 className={HEADLINE}>Community is the unit of human life.</h2>

      <p className={BODY}>
        Your family is a community. So are your friends. So is the hobby
        you&rsquo;ve always wanted to start, the people you want to learn from,
        and the company you dream of working for. Everything that matters to us
        has a community attached.
      </p>

      <p className={BODY}>
        We survived as a species because of community. We grew because of it.
        We found meaning, and found each other through it.
      </p>

      <p className={BODY}>
        Communities are the doors to the information, relationships, and
        opportunities that shape our lives. And yet the platforms we live on
        every day have done nothing to open them. Every platform before us
        optimised for the wrong thing. LinkedIn optimised for profession.
        Twitter for dialogue. Instagram for attention. None of them optimised
        for the thing we actually belong to. No one has ever tried to organise,
        visualise, and open the world&rsquo;s communities in one place.
      </p>

      <h2 className={HEADLINE}>Imagine this.</h2>

      <p className={BODY}>
        The first time you open Visvine, you can see an entire ecosystem at
        once. Knowledge that normally takes years to gather is visible
        instantly. You know the organisations doing the work you care about.
        You know who&rsquo;s hiring and who&rsquo;s building. You know the
        events happening near you this month and who&rsquo;ll be in the room.
        You know who to message and what they care about.
      </p>

      <p className={BODY}>
        You see the community you&rsquo;ve just joined, the communities next to
        it, and the people inside who once stood exactly where you&rsquo;re
        standing now.
      </p>

      <p className={BODY}>
        You don&rsquo;t need an introduction. You don&rsquo;t need permission.
        You don&rsquo;t need to have been born in the right place or known the
        right people. The information was always there. We&rsquo;ve just made
        it visible.
      </p>

      <p className="mt-12 text-center text-xl sm:text-2xl font-medium leading-relaxed text-black">
        Access to opportunity should be a human right, not a function of where
        you were born or who your parents knew.
      </p>

      <h2 className={HEADLINE}>What we&rsquo;re building.</h2>

      <p className={BODY}>
        Visvine is a platform that organises the world&rsquo;s communities and
        makes as much of their context public and accessible as possible.
        We&rsquo;re building it for the community owners who want to grow and
        scale on it, and for the individuals who simply want to find their
        people and belong to the communities that spark something in them.
      </p>

      <p className={BODY}>
        We&rsquo;re starting with the startup ecosystem across Australia and
        New Zealand, because that&rsquo;s the ecosystem we know best and the
        place we most want to see the impact first. But starting there
        doesn&rsquo;t mean stopping there. Your career and your hobby, your
        craft and your sport, your professional life and your personal one all
        belong on the same platform, so whatever community you come from, we
        want you here from day one.
      </p>

      <p className={BODY}>
        This is a platform built by the community, and we&rsquo;ll keep
        listening to it and building with it, because the opportunity people
        can reach depends entirely on how well we grow these communities
        together.
      </p>

      <p className={BODY}>
        We&rsquo;ll also be giving back to the ones that grow with us, funding
        their events, celebrating their builders, and treating them as
        partners, not products. We will never tailor a feed. You&rsquo;ll shape
        your own experience, represent yourself however you choose, and explore
        the different ecosystems on your own terms.
      </p>

      <p className="mt-12 text-xl sm:text-2xl leading-relaxed text-neutral-800">
        From now on, opportunity will never depend on your ability to see and
        interact with the world&rsquo;s communities.
      </p>

      <p className="mt-4 text-xl sm:text-2xl leading-relaxed text-neutral-800">
        We&rsquo;re making sure of it.
      </p>

      <p
        className="mt-16 sm:mt-20 text-center text-5xl sm:text-6xl md:text-7xl font-medium tracking-tight leading-[1.05]"
        style={{ color: BRAND }}
      >
        Welcome to Visvine.
      </p>

      <div className="mt-10 flex justify-center">
        <Link
          href="/?signup=1"
          className="inline-block rounded-md px-8 py-3.5 text-base font-medium shadow-sm transition hover:opacity-90 active:scale-[0.99]"
          style={{ backgroundColor: BRAND, color: "#ffffff" }}
        >
          Join our community
        </Link>
      </div>
    </article>
  );
}
