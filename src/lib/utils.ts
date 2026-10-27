import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fmtSigned = (v: number, digits = 0) => (v > 0 ? '+' : '') + v.toFixed(digits);
