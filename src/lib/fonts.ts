import {
  Inter,
  Poppins,
  Montserrat,
  Roboto,
  Open_Sans,
  Nunito,
  Bebas_Neue,
  Anton,
  Oswald,
  Archivo,
  Archivo_Black,
  DM_Sans,
  Plus_Jakarta_Sans,
  Manrope,
  Outfit,
  Urbanist,
  League_Spartan,
  Playfair_Display,
  DM_Serif_Display,
  Quicksand,
  Fredoka,
  Baloo_2,
  Hind,
  Noto_Sans_Devanagari,
  Noto_Sans_Gujarati,
  Caveat,
  Kalam,
  Bangers,
  Permanent_Marker,
} from "next/font/google";
import { slugFont } from "@/lib/subtitles/preview-style";
import { SCRIPT_FALLBACK_FONTS } from "@/lib/subtitles/script-detect";

// Central font registry. Adding a font = adding one entry here (loader + weight
// list) — every picker/preset/style-panel control reads from this file, so
// nothing else needs to change. `category` groups the font picker's dropdown
// (section 7 of the desktop UX pass) — kept deliberately curated rather than
// mirroring Google Fonts' entire catalog (section 6: "don't make the dropdown
// enormous"). Every font here is loaded via `next/font/google`, i.e. served
// from Google's own Fonts catalog — all of it is SIL Open Font License 1.1,
// which is what makes bundling/redistributing them in a desktop app fine.
export type FontCategory = "Sans" | "Impact" | "Editorial" | "Rounded" | "Handwritten" | "Display" | "Devanagari" | "Gujarati";

export interface FontDef {
  name: string;
  variable: string;
  weights: number[];
  category: FontCategory;
}

export const FONT_REGISTRY: FontDef[] = [
  { name: "Inter", variable: "--font-inter", weights: [400, 500, 600, 700, 800, 900], category: "Sans" },
  { name: "Poppins", variable: "--font-poppins", weights: [400, 500, 600, 700, 800, 900], category: "Sans" },
  { name: "Montserrat", variable: "--font-montserrat", weights: [400, 500, 600, 700, 800, 900], category: "Sans" },
  { name: "Roboto", variable: "--font-roboto", weights: [400, 500, 700, 900], category: "Sans" },
  { name: "Open Sans", variable: "--font-open-sans", weights: [400, 500, 600, 700, 800], category: "Sans" },
  { name: "DM Sans", variable: "--font-dm-sans", weights: [400, 500, 700, 900], category: "Sans" },
  { name: "Plus Jakarta Sans", variable: "--font-plus-jakarta-sans", weights: [400, 500, 600, 700, 800], category: "Sans" },
  { name: "Manrope", variable: "--font-manrope", weights: [400, 500, 600, 700, 800], category: "Sans" },
  { name: "Outfit", variable: "--font-outfit", weights: [400, 500, 600, 700, 800], category: "Sans" },
  { name: "Urbanist", variable: "--font-urbanist", weights: [400, 500, 600, 700, 800, 900], category: "Sans" },

  { name: "Bebas Neue", variable: "--font-bebas-neue", weights: [400], category: "Impact" },
  { name: "Anton", variable: "--font-anton", weights: [400], category: "Impact" },
  { name: "Oswald", variable: "--font-oswald", weights: [400, 500, 600, 700], category: "Impact" },
  { name: "Archivo", variable: "--font-archivo", weights: [400, 500, 600, 700, 800, 900], category: "Impact" },
  { name: "Archivo Black", variable: "--font-archivo-black", weights: [400], category: "Impact" },
  { name: "League Spartan", variable: "--font-league-spartan", weights: [400, 500, 600, 700, 800, 900], category: "Impact" },

  { name: "Playfair Display", variable: "--font-playfair-display", weights: [400, 500, 600, 700, 800, 900], category: "Editorial" },
  { name: "DM Serif Display", variable: "--font-dm-serif-display", weights: [400], category: "Editorial" },

  { name: "Nunito", variable: "--font-nunito", weights: [400, 600, 700, 800, 900], category: "Rounded" },
  { name: "Quicksand", variable: "--font-quicksand", weights: [400, 500, 600, 700], category: "Rounded" },
  { name: "Fredoka", variable: "--font-fredoka", weights: [400, 500, 600, 700], category: "Rounded" },
  { name: "Baloo 2", variable: "--font-baloo-2", weights: [400, 500, 600, 700, 800], category: "Rounded" },

  { name: "Caveat", variable: "--font-caveat", weights: [400, 500, 600, 700], category: "Handwritten" },
  { name: "Kalam", variable: "--font-kalam", weights: [400, 700], category: "Handwritten" },
  { name: "Permanent Marker", variable: "--font-permanent-marker", weights: [400], category: "Handwritten" },
  { name: "Bangers", variable: "--font-bangers", weights: [400], category: "Display" },

  { name: "Noto Sans Devanagari", variable: "--font-noto-sans-devanagari", weights: [400, 500, 600, 700], category: "Devanagari" },
  { name: "Hind", variable: "--font-hind", weights: [400, 500, 600, 700], category: "Devanagari" },

  { name: "Noto Sans Gujarati", variable: "--font-noto-sans-gujarati", weights: [400, 500, 600, 700], category: "Gujarati" },
];

export const FONT_NAMES = FONT_REGISTRY.map((f) => f.name);

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const poppins = Poppins({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800", "900"], variable: "--font-poppins", display: "swap" });
const montserrat = Montserrat({ subsets: ["latin"], variable: "--font-montserrat", display: "swap" });
const roboto = Roboto({ subsets: ["latin"], weight: ["400", "500", "700", "900"], variable: "--font-roboto", display: "swap" });
const openSans = Open_Sans({ subsets: ["latin"], variable: "--font-open-sans", display: "swap" });
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans", display: "swap" });
const plusJakartaSans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-plus-jakarta-sans", display: "swap" });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", display: "swap" });
const urbanist = Urbanist({ subsets: ["latin"], variable: "--font-urbanist", display: "swap" });

const bebasNeue = Bebas_Neue({ subsets: ["latin"], weight: "400", variable: "--font-bebas-neue", display: "swap" });
const anton = Anton({ subsets: ["latin"], weight: "400", variable: "--font-anton", display: "swap" });
const oswald = Oswald({ subsets: ["latin"], variable: "--font-oswald", display: "swap" });
const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo", display: "swap" });
const archivoBlack = Archivo_Black({ subsets: ["latin"], weight: "400", variable: "--font-archivo-black", display: "swap" });
const leagueSpartan = League_Spartan({ subsets: ["latin"], variable: "--font-league-spartan", display: "swap" });

const playfairDisplay = Playfair_Display({ subsets: ["latin"], variable: "--font-playfair-display", display: "swap" });
const dmSerifDisplay = DM_Serif_Display({ subsets: ["latin"], weight: "400", variable: "--font-dm-serif-display", display: "swap" });

const nunito = Nunito({ subsets: ["latin"], variable: "--font-nunito", display: "swap" });
const quicksand = Quicksand({ subsets: ["latin"], variable: "--font-quicksand", display: "swap" });
const fredoka = Fredoka({ subsets: ["latin"], variable: "--font-fredoka", display: "swap" });
const baloo2 = Baloo_2({ subsets: ["latin"], variable: "--font-baloo-2", display: "swap" });

// P20.2 style families: handwritten (Caveat, Kalam, Permanent Marker) and comic display (Bangers).
const caveat = Caveat({ subsets: ["latin"], variable: "--font-caveat", display: "swap" });
const kalam = Kalam({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-kalam", display: "swap" });
const permanentMarker = Permanent_Marker({ subsets: ["latin"], weight: "400", variable: "--font-permanent-marker", display: "swap" });
const bangers = Bangers({ subsets: ["latin"], weight: "400", variable: "--font-bangers", display: "swap" });

// Noto Sans Devanagari/Gujarati are loaded with the "latin" subset too (in
// addition to their own script) so they work correctly both as the automatic
// per-word fallback (see SCRIPT_FALLBACK_FONTS below) AND as a selectable
// primary style — a mixed-language caption's Latin words still render
// correctly instead of silently falling back to a generic system font.
const notoDevanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari", "latin"],
  variable: "--font-noto-sans-devanagari",
  display: "swap",
});
const hind = Hind({ subsets: ["devanagari", "latin"], weight: ["400", "500", "600", "700"], variable: "--font-hind", display: "swap" });
const notoGujarati = Noto_Sans_Gujarati({
  subsets: ["gujarati", "latin"],
  variable: "--font-noto-sans-gujarati",
  display: "swap",
});

export { SCRIPT_FALLBACK_FONTS };

export const FONT_VARIABLE_CLASS = [
  inter.variable,
  poppins.variable,
  montserrat.variable,
  roboto.variable,
  openSans.variable,
  dmSans.variable,
  plusJakartaSans.variable,
  manrope.variable,
  outfit.variable,
  urbanist.variable,
  bebasNeue.variable,
  anton.variable,
  oswald.variable,
  archivo.variable,
  archivoBlack.variable,
  leagueSpartan.variable,
  playfairDisplay.variable,
  dmSerifDisplay.variable,
  nunito.variable,
  quicksand.variable,
  fredoka.variable,
  baloo2.variable,
  caveat.variable,
  kalam.variable,
  permanentMarker.variable,
  bangers.variable,
  notoDevanagari.variable,
  hind.variable,
  notoGujarati.variable,
].join(" ");

export { slugFont };
