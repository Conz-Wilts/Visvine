import Image from "next/image";
import { BRAND } from "@/lib/brand";

export default function Contact() {
  return (
    <section className="flex-1 flex flex-col items-center justify-center px-5 sm:px-10 md:px-20 py-12 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row items-center justify-center gap-10 sm:gap-14 lg:gap-16">
        <div
          className="overflow-hidden rounded-3xl max-w-full"
          style={{ border: `7px solid ${BRAND}` }}
        >
          <Image
            src="/images/connor.jpg"
            alt="Connor Wiltshire"
            width={1366}
            height={2048}
            priority
            className="block w-64 min-[480px]:w-72 sm:w-72 md:w-80 lg:w-[22rem] h-auto max-w-full"
          />
        </div>

        <div className="flex flex-col items-center sm:items-start gap-4 text-center sm:text-left">
          <div>
            <p className="text-3xl sm:text-4xl md:text-5xl font-medium tracking-tight">
              Connor Wiltshire
            </p>
            <p className="mt-2 text-base sm:text-lg text-neutral-600">
              Creator of Visvine
            </p>
          </div>

          <div className="flex flex-col items-center sm:items-start gap-2 text-base sm:text-lg">
            <a
              href="mailto:connor@visvine.com"
              className="text-black underline-offset-4 hover:underline"
            >
              connor@visvine.com
            </a>
            <a
              href="https://www.linkedin.com/in/connor-wiltshire-9a4304255/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-black underline-offset-4 hover:underline"
            >
              LinkedIn
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
