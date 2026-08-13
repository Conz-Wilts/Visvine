import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import HomeCtas from "@/features/marketing/components/HomeCtas";

export default async function Home() {
  const session = await getSession();
  if (session) redirect("/home");

  return (
    <section className="flex-1 flex flex-col items-center justify-center px-5 sm:px-10 md:px-16 lg:px-24 py-10 sm:py-14 text-center">
      <h1 className="text-[1.75rem] sm:text-4xl md:text-5xl lg:text-[3.75rem] font-medium tracking-tight leading-[1.1] max-w-4xl lg:max-w-6xl text-balance">
        Every ecosystem, visualised. Every opportunity, accessible.
      </h1>
      <p className="mt-4 sm:mt-6 text-base sm:text-lg md:text-xl lg:text-2xl text-neutral-600 max-w-2xl">
        The space platform built by space.
      </p>
      <div className="mt-8 sm:mt-10 w-full max-w-md">
        <HomeCtas />
      </div>
    </section>
  );
}
