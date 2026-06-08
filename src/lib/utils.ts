import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Build a clickable short URL on the current origin (works in dev and prod). */
export function shortUrlFor(slug: string): string {
  return `${window.location.origin}/${slug}`;
}
