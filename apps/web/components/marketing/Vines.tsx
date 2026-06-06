"use client";

import { useEffect, useState } from "react";
import { BRAND } from "@/lib/brand";

export default function Vines() {
  const stroke = BRAND;
  const width = 40;

  const [periods, setPeriods] = useState(2);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const compute = () => {
      const vh = window.innerHeight || 1;
      const ph = document.documentElement.scrollHeight;
      setPeriods(Math.max(2, Math.ceil(ph / vh) + 1));
    };
    compute();
    window.addEventListener("resize", compute);
    const ro = new ResizeObserver(compute);
    ro.observe(document.body);
    return () => {
      window.removeEventListener("resize", compute);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  function buildPath(controls: [number, number][][], mirror: boolean) {
    const x = (v: number) => (mirror ? 100 - v : v);
    const segs: string[] = [];
    for (let p = -1; p <= periods + 1; p++) {
      const baseY = p * 600;
      if (p === -1) segs.push(`M ${x(50)} ${baseY}`);
      for (const [c1, c2, end] of controls) {
        segs.push(
          `C ${x(c1[0])} ${baseY + c1[1]}, ${x(c2[0])} ${baseY + c2[1]}, ${x(end[0])} ${baseY + end[1]}`
        );
      }
    }
    return segs.join(" ");
  }

  const period: [number, number][][] = [
    [[100, 80], [30, 200], [50, 300]],
    [[70, 400], [0, 520], [50, 600]],
  ];

  const leftPath = buildPath(period, false);
  const rightPath = buildPath(period, true);

  const viewBoxH = 600 * periods;
  const heightStyle = { height: `${periods * 100}svh` } as const;

  return (
    <>
      <svg
        className="pointer-events-none absolute left-0 top-0 hidden lg:block lg:w-[220px] xl:w-[300px] 2xl:w-[340px]"
        style={heightStyle}
        viewBox={`0 0 100 ${viewBoxH}`}
        preserveAspectRatio="none"
        fill="none"
        aria-hidden
      >
        <g>
          <path
            d={leftPath}
            stroke={stroke}
            strokeWidth={width}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {!reducedMotion && (
            <animateTransform
              attributeName="transform"
              type="translate"
              from="0 0"
              to="0 600"
              dur="14s"
              repeatCount="indefinite"
            />
          )}
        </g>
      </svg>
      <svg
        className="pointer-events-none absolute right-0 top-0 hidden lg:block lg:w-[220px] xl:w-[300px] 2xl:w-[340px]"
        style={heightStyle}
        viewBox={`0 0 100 ${viewBoxH}`}
        preserveAspectRatio="none"
        fill="none"
        aria-hidden
      >
        <g>
          <path
            d={rightPath}
            stroke={stroke}
            strokeWidth={width}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {!reducedMotion && (
            <animateTransform
              attributeName="transform"
              type="translate"
              from="0 0"
              to="0 600"
              dur="17s"
              repeatCount="indefinite"
            />
          )}
        </g>
      </svg>
    </>
  );
}
