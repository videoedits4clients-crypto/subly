import type { Subtitle } from "@/types/subtitle";

function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const msRem = ms % 1000;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(msRem, 3)}`;
}

function vttTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const msRem = ms % 1000;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(msRem, 3)}`;
}

function pad(n: number, len: number) {
  return String(n).padStart(len, "0");
}

export function toSRT(subtitles: Subtitle[]): string {
  return subtitles
    .map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}\n`)
    .join("\n");
}

export function toVTT(subtitles: Subtitle[]): string {
  const body = subtitles
    .map((s) => `${vttTime(s.start)} --> ${vttTime(s.end)}\n${s.text}\n`)
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

export function toTXT(subtitles: Subtitle[]): string {
  return subtitles.map((s) => s.text.replace(/\n/g, " ")).join("\n");
}
