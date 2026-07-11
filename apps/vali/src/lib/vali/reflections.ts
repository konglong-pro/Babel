import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";

import type { ValiDatabase } from "../db/client";
import { reflection } from "../db/schema";
import { NotFoundError, ValidationError } from "./errors";
import type { Reflection, ValiVault } from "./types";

export function createReflectionOperations(database: ValiDatabase): ValiVault["reflections"] {
  const client = drizzle(database);

  return {
    listDates: () =>
      client
        .select({ date: reflection.date })
        .from(reflection)
        .orderBy(desc(reflection.date))
        .all()
        .map((item) => item.date)
        .filter(isValidReflectionDate),
    get: (date) => {
      validateReflectionDate(date);
      const current = client.select().from(reflection).where(eq(reflection.date, date)).get();
      if (!current) {
        throw new NotFoundError(`Reflection not found: ${date}`);
      }
      return current satisfies Reflection;
    },
    save: (date, content) => {
      if (typeof content !== "string") {
        throw new ValidationError("Reflection content must be a string");
      }
      validateReflectionDate(date);
      const saved: Reflection = { date, content };
      client
        .insert(reflection)
        .values(saved)
        .onConflictDoUpdate({ target: reflection.date, set: { content } })
        .run();
      return saved;
    },
  };
}

function validateReflectionDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ValidationError("Reflection date must use YYYY-MM-DD");
  }
  const [year, month, day] = date.split("-").map(Number);
  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) {
    throw new ValidationError("Reflection date must be a valid calendar date");
  }
}

function isValidReflectionDate(date: string): boolean {
  try {
    validateReflectionDate(date);
    return true;
  } catch (error) {
    if (error instanceof ValidationError) {
      return false;
    }
    throw error;
  }
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
