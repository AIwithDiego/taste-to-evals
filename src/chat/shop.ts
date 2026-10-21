// Loads Ollie's public menu (what the chatbot reads) and Gráinne's allergen sheet (what the checks read).
import { readFileSync } from "node:fs";
import type { AllergenEntry, Shop } from "./domain.js";

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  description: string;
}

export interface Menu {
  openingHours: { open: string; close: string; days: string };
  items: MenuItem[];
}

const read = (file: string): unknown => JSON.parse(readFileSync(new URL(`../../data/ollies/${file}`, import.meta.url), "utf8"));

/** The menu page, as the website shows it. All the chatbot can see. */
export function loadMenu(): Menu {
  return read("menu.json") as Menu;
}

/** The facts the checks hold a reply to. */
export function loadShop(): Shop {
  const menu = loadMenu();
  const sheet = read("allergens.json") as { items: AllergenEntry[] };
  return { allergens: sheet.items, openingHours: { open: menu.openingHours.open, close: menu.openingHours.close } };
}
