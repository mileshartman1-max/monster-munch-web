// pages/index.tsx
// Monster Munch — Candy Crush specials, combos, cascades, Debug + QA seeding
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Howl } from "howler";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
} from "firebase/firestore";

// ----------------------------- Types ---------------------------------
type SpecialType = "none" | "striped-h" | "striped-v" | "wrapped" | "colorbomb";
type MonsterTile = { id: string; src: string; special: SpecialType; selected?: boolean };
type Board = Array<MonsterTile | null>;
type MatchInfo = {
  tiles: number[];
  orientation?: "h" | "v";
  specialAt?: number;
  specialType?: SpecialType;
};

// --------------------------- Constants --------------------------------
const BOARD_SIZE = 8;
const TILE_SIZE = 48;

const BASE_MONSTERS: Omit<MonsterTile, "selected">[] = [
  { id: "blue", src: "/monsters/blue.png", special: "none" },
  { id: "pink", src: "/monsters/pink.png", special: "none" },
  { id: "green", src: "/monsters/green.png", special: "none" },
  { id: "yellow", src: "/monsters/yellow.png", special: "none" },
  { id: "purple", src: "/monsters/purple.png", special: "none" },
  { id: "orange", src: "/monsters/orange.png", special: "none" },
];

const idx = (r: number, c: number) => r * BOARD_SIZE + c;
const inBounds = (r: number, c: number) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
const isAdjacent = (a: number, b: number) => {
  const ar = Math.floor(a / BOARD_SIZE), ac = a % BOARD_SIZE;
  const br = Math.floor(b / BOARD_SIZE), bc = b % BOARD_SIZE;
  return (ar === br && Math.abs(ac - bc) === 1) || (ac === bc && Math.abs(ar - br) === 1);
};
const neighbors8 = (r: number, c: number) =>
  [
    [r - 1, c - 1], [r - 1, c], [r - 1, c + 1],
    [r, c - 1],                 [r, c + 1],
    [r + 1, c - 1], [r + 1, c], [r + 1, c + 1],
  ].filter(([rr, cc]) => inBounds(rr, cc));

// ------------------------ Firebase (fill me) --------------------------
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ----------------------------- Audio ----------------------------------
const matchSound =
  typeof window !== "undefined" ? new Howl({ src: ["/sounds/match.mp3"], volume: 0.6 }) : ({} as Howl);
const specialSound =
  typeof window !== "undefined" ? new Howl({ src: ["/sounds/special.mp3"], volume: 0.7 }) : ({} as Howl);
const bgMusic =
  typeof window !== "undefined" ? new Howl({ src: ["/sounds/bg-composed.mp3"], loop: true, volume: 0.35 }) : ({} as Howl);

// --------------------------- Tile helpers -----------------------------
function cloneTile(tile: Omit<MonsterTile, "selected">): MonsterTile {
  return { ...tile, selected: false };
}
function randomBase(): Omit<MonsterTile, "selected"> {
  return BASE_MONSTERS[(Math.random() * BASE_MONSTERS.length) | 0];
}
function freshTile(): MonsterTile {
  return cloneTile(randomBase());
}

// --------------------------- Match detection --------------------------
function detectMatches(board: Board, DEBUG = false): MatchInfo[] {
  const matches: MatchInfo[] = [];

  function collectRun(line: number[], orientation: "h" | "v") {
    let start = 0;
    while (start < line.length) {
      const t0 = board[line[start]];
      if (!t0) { start++; continue; }
      let end = start + 1;
      while (end < line.length && board[line[end]]?.id === t0.id) end++;
      const len = end - start;
      if (len >= 3) {
        const tiles = line.slice(start, end);
        let specialType: SpecialType | undefined;
        if (len >= 5) specialType = "colorbomb";
        else if (len === 4) specialType = orientation === "h" ? "striped-h" : "striped-v";
        const specialAt = tiles[(tiles.length / 2) | 0];
        matches.push({ tiles, orientation, specialAt, specialType });
      }
      start = end;
    }
  }

  // Horizontal
  for (let r = 0; r < BOARD_SIZE; r++) collectRun(Array.from({ length: BOARD_SIZE }, (_, c) => idx(r, c)), "h");
  // Vertical
  for (let c = 0; c < BOARD_SIZE; c++) collectRun(Array.from({ length: BOARD_SIZE }, (_, r) => idx(r, c)), "v");

  // L/T shapes → wrapped: find cells part of both an H run and a V run (length >=3)
  const hRun: boolean[] = Array(BOARD_SIZE * BOARD_SIZE).fill(false);
  const vRun: boolean[] = Array(BOARD_SIZE * BOARD_SIZE).fill(false);

  // mark horizontal runs
  for (let r = 0; r < BOARD_SIZE; r++) {
    let c = 0;
    while (c < BOARD_SIZE) {
      const t0 = board[idx(r, c)];
      if (!t0) { c++; continue; }
      let c2 = c + 1;
      while (c2 < BOARD_SIZE && board[idx(r, c2)]?.id === t0.id) c2++;
      if (c2 - c >= 3) for (let cc = c; cc < c2; cc++) hRun[idx(r, cc)] = true;
      c = c2;
    }
  }
  // mark vertical runs
  for (let c = 0; c < BOARD_SIZE; c++) {
    let r = 0;
    while (r < BOARD_SIZE) {
      const t0 = board[idx(r, c)];
      if (!t0) { r++; continue; }
      let r2 = r + 1;
      while (r2 < BOARD_SIZE && board[idx(r2, c)]?.id === t0.id) r2++;
      if (r2 - r >= 3) for (let rr = r; rr < r2; rr++) vRun[idx(rr, c)] = true;
      r = r2;
    }
  }
  for (let i = 0; i < BOARD_SIZE * BOARD_SIZE; i++) {
    if (hRun[i] && vRun[i]) {
      const center = i;
      const id0 = board[center]?.id;
      if (!id0) continue;
      // gather plus-shaped tiles of same id
      const r = Math.floor(center / BOARD_SIZE), c = center % BOARD_SIZE;
      const plus = [center];
      [[0,-1],[0,1],[-1,0],[1,0]].forEach(([dr,dc]) => {
        let rr = r + dr, cc = c + dc;
        while (inBounds(rr, cc) && board[idx(rr, cc)]?.id === id0) {
          plus.push(idx(rr, cc)); rr += dr; cc += dc;
        }
      });
      if (plus.length >= 5) matches.push({ tiles: Array.from(new Set(plus)), specialAt: center, specialType: "wrapped" });
    }
  }

  if (DEBUG) console.log("detectMatches ->", matches);
  return matches;
}

// -------------------------- Resolve & gravity -------------------------
function resolveBoardWithMatches(
  board: Board,
  matches: MatchInfo[],
  setScore: React.Dispatch<React.SetStateAction<number>>,
  DEBUG = false
): Board {
  if (!matches.length) return board;
  const next: Board = [...board];

  // 1) Decide special holders first and mark them; exclude from clearing
  const toClear = new Set<number>();
  for (const m of matches) {
    m.tiles.forEach((i) => toClear.add(i));
    if (m.specialType && m.specialAt !== undefined && next[m.specialAt]) {
      toClear.delete(m.specialAt); // do NOT clear the special tile
      const original = next[m.specialAt]!;
      next[m.specialAt] = { ...original, special: m.specialType };
      if (DEBUG) console.log("Create special", m.specialType, "at", m.specialAt);
    }
  }

  // 2) Clear the rest
  let cleared = 0;
  toClear.forEach((i) => { if (next[i]) { next[i] = null; cleared++; } });
  if (cleared > 0) {
    setScore((s) => s + cleared * 10);
    matchSound?.play();
  }

  // 3) Gravity & fill
  for (let c = 0; c < BOARD_SIZE; c++) {
    let write = BOARD_SIZE - 1;
    for (let r = BOARD_SIZE - 1; r >= 0; r--) {
      const i = idx(r, c);
      if (next[i]) {
        if (write !== r) { next[idx(write, c)] = next[i]; next[i] = null; }
        write--;
      }
    }
    for (let r = write; r >= 0; r--) next[idx(r, c)] = freshTile();
  }

  if (DEBUG) console.log("resolveBoardWithMatches -> after", next);
  return next;
}

// ---------------------------- Special triggers ------------------------
function triggerSpecialAt(board: Board, pos: number): Board {
  const next = [...board];
  const t = next[pos];
  if (!t) return next;

  const r = Math.floor(pos / BOARD_SIZE), c = pos % BOARD_SIZE;
  const clear = (i: number) => { if (next[i]) next[i] = null; };

  switch (t.special) {
    case "striped-h":
      for (let cc = 0; cc < BOARD_SIZE; cc++) clear(idx(r, cc));
      break;
    case "striped-v":
      for (let rr = 0; rr < BOARD_SIZE; rr++) clear(idx(rr, c));
      break;
    case "wrapped": {
      for (let rr = r - 1; rr <= r + 1; rr++)
        for (let cc = c - 1; cc <= c + 1; cc++)
          if (inBounds(rr, cc)) clear(idx(rr, cc));
      for (let rr = r - 2; rr <= r + 2; rr++)
        for (let cc = c - 2; cc <= c + 2; cc++)
          if (inBounds(rr, cc)) clear(idx(rr, cc));
      break;
    }
    case "colorbomb": {
      const targetId = t.id;
      for (let i = 0; i < next.length; i++) if (next[i]?.id === targetId) clear(i);
      clear(pos);
      break;
    }
    default: break;
  }
  return next;
}

// ----------------------------- Combo logic ----------------------------
function applyCombo(board: Board, a: number, b: number): Board | null {
  const ta = board[a], tb = board[b];
  if (!ta || !tb) return null;
  if (ta.special === "none" && tb.special === "none") return null;

  // colorbomb + X
  if (ta.special === "colorbomb" || tb.special === "colorbomb") {
    const other = ta.special === "colorbomb" ? tb : ta;
    const next = [...board];

    if (other.special === "colorbomb") { for (let i = 0; i < next.length; i++) next[i] = null; return next; }

    if (other.special === "striped-h" || other.special === "striped-v") {
      for (let i = 0; i < next.length; i++) if (next[i]?.id === other.id)
        next[i] = { ...next[i]!, special: Math.random() < 0.5 ? "striped-h" : "striped-v" };
      for (let i = 0; i < next.length; i++)
        if (next[i]?.special === "striped-h" || next[i]?.special === "striped-v")
          Object.assign(next, triggerSpecialAt(next, i));
      return next;
    }

    if (other.special === "wrapped") {
      for (let i = 0; i < next.length; i++) if (next[i]?.id === other.id)
        next[i] = { ...next[i]!, special: "wrapped" };
      for (let i = 0; i < next.length; i++)
        if (next[i]?.special === "wrapped") Object.assign(next, triggerSpecialAt(next, i));
      return next;
    }

    for (let i = 0; i < next.length; i++) if (next[i]?.id === other.id) next[i] = null;
    next[a] = null; next[b] = null;
    return next;
  }

  // striped + striped → row & column clear at each
  if (
    (ta.special === "striped-h" || ta.special === "striped-v") &&
    (tb.special === "striped-h" || tb.special === "striped-v")
  ) {
    const next = [...board];
    const rA = Math.floor(a / BOARD_SIZE), cA = a % BOARD_SIZE;
    const rB = Math.floor(b / BOARD_SIZE), cB = b % BOARD_SIZE;
    for (let cc = 0; cc < BOARD_SIZE; cc++) { next[idx(rA, cc)] = null; next[idx(rB, cc)] = null; }
    for (let rr = 0; rr < BOARD_SIZE; rr++) { next[idx(rr, cA)] = null; next[idx(rr, cB)] = null; }
    return next;
  }

  // wrapped + wrapped → big double blast
  if (ta.special === "wrapped" && tb.special === "wrapped") {
    const boom = (center: number, arr: Board) => {
      const out = [...arr];
      const r = Math.floor(center / BOARD_SIZE), c = center % BOARD_SIZE;
      for (let rr = r - 2; rr <= r + 2; rr++)
        for (let cc = c - 2; cc <= c + 2; cc++)
          if (inBounds(rr, cc)) out[idx(rr, cc)] = null;
      return out;
    };
    return boom(b, boom(a, board));
  }

  // striped + wrapped → cross (3 rows + 3 cols)
  if (
    (ta.special === "striped-h" || ta.special === "striped-v") && tb.special === "wrapped"
  ) {
    const next = [...board];
    const blast = (center: number) => {
      const r = Math.floor(center / BOARD_SIZE), c = center % BOARD
