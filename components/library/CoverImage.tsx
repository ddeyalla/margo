"use client";

import { useState } from "react";
import Image from "next/image";

/** A book's cover, gone when the book has none so the panel beneath shows instead of a broken image. */
export function CoverImage({ src }: { src: string }) {
  const [missing, setMissing] = useState(false);
  if (missing) return null;
  return <Image src={src} alt="" fill unoptimized className="object-cover" onError={() => setMissing(true)} />;
}
