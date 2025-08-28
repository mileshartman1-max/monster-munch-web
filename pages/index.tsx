// pages/index.tsx
// Monster Munch — Candy Crush–style specials + combos + cascades
// - 4 in a row/col  -> striped-h / striped-v
// - 5 in a row      -> colorbomb
// - L/T shape       -> wrapped
// - Combos: colorbomb+x, striped+striped, wrapped+wrapped, striped+wrapped
// Firebase hooks preserved (fill firebaseConfig). Debug overlay included.

import React, { useEffect, useMemo, useRef, useState } from "react";
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

type SpecialType =
  | "none"
  | "striped-h"
  | "striped-v"
  | "wrapped"
  | "colorbomb";

type MonsterTile = {
  id: string; // color/type id
  src: string; // image path
  special: SpecialType;
  selected?: boolean;
};

type Board = Array<MonsterTile | null>;

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
  typeof window !== "undefined"
    ? new Howl({ src: ["/sounds/match.mp3"], volume: 0.6 })
    : ({} as Howl);
const specialSound =
  typeof window !== "undefined"
    ? new Howl({ src: ["/sounds/special.mp3"], volume: 0.7 })
    : ({} as Howl);
const bgMusic =
  typeof window !== "undefined"
    ? new Howl({ src: ["/sounds/bg-composed.mp3"], loop: true, volume: 0.35 })
    : ({} as Howl);

// --------------------------- Utilities --------------------------------

const idx = (r: number, c: number) => r * BOARD_SIZE + c;

function cloneTile(tile: Omit<MonsterTile, "selected">): MonsterTile {
  return { ...tile, selected: false };
}
function randomBase(): Omit<MonsterTile, "selected"> {
  return BASE_MONSTERS[(Math.random() * BASE_MONSTERS.length) | 0];
}
function freshTile(): MonsterTile {
  return cloneTile(randomBase());
}
function inBounds(r: number, c: number) {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}
function neighbors8(r: number, c: number) {
  return [
    [r - 1, c - 1],
    [r - 1, c],
    [r - 1, c + 1],
    [r, c - 1],
    [r, c + 1],
    [r + 1, c - 1],
    [r + 1, c],
    [r + 1, c + 1],
  ].filter(([rr, cc]) => inBounds(rr, cc));
}
function isAdjacent(a: number, b: number) {
  const ar = Math.floor(a / BOARD_SIZE),
    ac = a % BOARD_SIZE;
  const br = Math.floor(b / BOARD_SIZE),
    bc = b % BOARD_SIZE;
  return (ar === br && Math.abs(ac - bc) === 1) || (ac === bc && Math.abs(ar - br) === 1);
}

// Detect runs and shapes; return structures describing matches & special placement.
type MatchInfo = {
  tiles: number[]; // indexes to clear
  orientation?: "h" | "v"; // for 4/5 lines
  specialAt?: number; // index that should become special
  specialType?: SpecialType;
};

function detectMatches(board: Board, DEBUG = false): MatchInfo[] {
  const matches: MatchInfo[] = [];
  const used = new Set<number>();

  // Helper to collect linear runs
  function collectRun(line: number[], orientation: "h" | "v") {
    let start = 0;
    while (start < line.length) {
      const tile0 = board[line[start]];
      if (!tile0) {
        start++;
        continue;
      }
      let end = start + 1;
      while (
        end < line.length &&
        board[line[end]] &&
        board[line[end]]!.id === tile0.id
      ) {
        end++;
      }
      const len = end - start;
      if (len >= 3) {
        const tiles = line.slice(start, end);
        // Determine special type from length
        let specialType: SpecialType | undefined;
        if (len >= 5) specialType = "colorbomb";
        else if (len === 4) specialType = orientation === "h" ? "striped-h" : "striped-v";
        // choose the special location — pick the "center" of the run
        const specialAt = tiles[(tiles.length / 2) | 0];

        matches.push({ tiles, orientation, specialAt, specialType });
        tiles.forEach((t) => used.add(t));
      }
      start = end;
    }
  }

  // Horizontal runs
  for (let r = 0; r < BOARD_SIZE; r++) {
    const line = Array.from({ length: BOARD_SIZE }, (_, c) => idx(r, c));
    collectRun(line, "h");
  }
  // Vertical runs
  for (let c = 0; c < BOARD_SIZE; c++) {
    const line = Array.from({ length: BOARD_SIZE }, (_, r) => idx(r, c));
    collectRun(line, "v");
  }

  // L/T shapes: cell part of both an H-run and a V-run (>=3 in each)
  // Build quick maps of run membership
  const hCount: Record<number, number> = {};
  const vCount: Record<number, number> = {};
  const byIndex = new Map<number, { h?: number[]; v?: number[] }>();

  function markRuns(orientation: "h" | "v") {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        // only check starts of potential runs
        const run: number[] = [];
        let rr = r,
          cc = c;
        const getId = (r2: number, c2: number) =>
          inBounds(r2, c2) && board[idx(r2, c2)] ? board[idx(r2, c2)]!.id : null;

        const id0 = getId(r, c);
        if (!id0) continue;

        while (inBounds(rr, cc) && getId(rr, cc) === id0) {
          run.push(idx(rr, cc));
          if (orientation === "h") cc++;
          else rr++;
        }
        if (run.length >= 3) {
          if (orientation === "h") run.forEach((i) => (hCount[i] = (hCount[i] || 0) + 1));
          else run.forEach((i) => (vCount[i] = (vCount[i] || 0) + 1));
          // skip to end of run
          if (orientation === "h") c = cc - 1;
          else r = rr - 1;
        }
      }
    }
  }
  markRuns("h");
  markRuns("v");

  // Find cells that are part of both → wrapped
  const wrappedCenters: number[] = [];
  for (let i = 0; i < BOARD_SIZE * BOARD_SIZE; i++) {
    if (hCount[i] && vCount[i]) wrappedCenters.push(i);
  }
  if (wrappedCenters.length) {
    wrappedCenters.forEach((center) => {
      // Make a wrapped match that includes all touching same-id tiles forming a plus
      const r = Math.floor(center / BOARD_SIZE),
        c = center % BOARD_SIZE;
      const id0 = board[center]?.id;
      if (!id0) return;

      const plus: number[] = [center];
      // extend each direction at least 1
      const dirs: Array<[number, number]> = [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ];
      dirs.forEach(([dr, dc]) => {
        let rr = r + dr,
          cc = c + dc;
        while (inBounds(rr, cc) && board[idx(rr, cc)]?.id === id0) {
          plus.push(idx(rr, cc));
          rr += dr;
          cc += dc;
        }
      });
      if (plus.length >= 5) {
        matches.push({
          tiles: Array.from(new Set(plus)),
          specialType: "wrapped",
          specialAt: center,
        });
      }
    });
  }

  // Merge overlapping matches (keep special from the largest)
  matches.sort((a, b) => b.tiles.length - a.tiles.length);
  const final: MatchInfo[] = [];
  const seen = new Set<number>();
  for (const m of matches) {
    const overlap = m.tiles.some((t) => seen.has(t));
    m.tiles.forEach((t) => seen.add(t));
    final.push(m);
  }

  if (DEBUG) console.log("detectMatches ->", final);
  return final;
}

// Apply clears, create specials, drop & fill, and repeat until stable.
function resolveBoardWithMatches(
  board: Board,
  matches: MatchInfo[],
  setScore: React.Dispatch<React.SetStateAction<number>>,
  DEBUG = false
): Board {
  if (!matches.length) return board;

  specialSound?.play();

  // Mark tiles to clear & create specials
  const toClear = new Set<number>();
  const specialsToCreate: Array<{ at: number; special: SpecialType; id?: string }> = [];

  for (const m of matches) {
    m.tiles.forEach((t) => toClear.add(t));
    if (m.specialType && m.specialAt !== undefined) {
      specialsToCreate.push({
        at: m.specialAt,
        special: m.specialType,
        id: board[m.specialAt]?.id,
      });
    }
  }

  // Clear tiles
  const next: Board = [...board];
  let clearedCount = 0;
  toClear.forEach((i) => {
    if (next[i]) {
      next[i] = null;
      clearedCount++;
    }
  });
  if (clearedCount > 0) {
    setScore((s) => s + clearedCount * 10);
    matchSound?.play();
  }

  // Drop tiles
  for (let c = 0; c < BOARD_SIZE; c++) {
    let write = BOARD_SIZE - 1;
    for (let r = BOARD_SIZE - 1; r >= 0; r--) {
      const i = idx(r, c);
      if (next[i]) {
        if (write !== r) {
          next[idx(write, c)] = next[i];
          next[i] = null;
        }
        write--;
      }
    }
    // Fill top with new tiles
    for (let r = write; r >= 0; r--) {
      next[idx(r, c)] = freshTile();
    }
  }

  // Place specials (after gravity) — pick the closest tile of same ID if original spot changed
  specialsToCreate.forEach(({ at, special, id }) => {
    // find a non-null tile in neighborhood to host the special (same id if possible)
    const r0 = Math.floor(at / BOARD_SIZE),
      c0 = at % BOARD_SIZE;
    const cand: number[] = [at, ...neighbors8(r0, c0).map(([rr, cc]) => idx(rr, cc))];
    let spot = cand.find((i) => next[i] && (!id || next[i]!.id === id));
    if (spot === undefined) spot = at; // fallback
    if (next[spot]) next[spot] = { ...next[spot]!, special };
  });

  if (DEBUG) console.log("resolveBoardWithMatches -> after", next);
  return next;
}

// Trigger effects for a single special tile
function triggerSpecialAt(board: Board, pos: number, DEBUG = false): Board {
  const next = [...board];
  const t = next[pos];
  if (!t) return next;

  const r = Math.floor(pos / BOARD_SIZE),
    c = pos % BOARD_SIZE;

  const clear = (i: number) => {
    if (next[i]) next[i] = null;
  };

  switch (t.special) {
    case "striped-h":
      for (let cc = 0; cc < BOARD_SIZE; cc++) clear(idx(r, cc));
      break;
    case "striped-v":
      for (let rr = 0; rr < BOARD_SIZE; rr++) clear(idx(rr, c));
      break;
    case "wrapped": {
      const area: number[] = [];
      for (let rr = r - 1; rr <= r + 1; rr++) {
        for (let cc = c - 1; cc <= c + 1; cc++) {
          if (inBounds(rr, cc)) area.push(idx(rr, cc));
        }
      }
      area.forEach(clear);
      // wrapped explodes twice — expand one more ring
      const area2: number[] = [];
      for (let rr = r - 2; rr <= r + 2; rr++) {
        for (let cc = c - 2; cc <= c + 2; cc++) {
          if (inBounds(rr, cc)) area2.push(idx(rr, cc));
        }
      }
      area2.forEach(clear);
      break;
    }
    case "colorbomb": {
      const targetId = t.id;
      for (let i = 0; i < next.length; i++) {
        if (next[i]?.id === targetId) clear(i);
      }
      clear(pos);
      break;
    }
    default:
      break;
  }
  return next;
}

// Combo rules for when two specials are swapped directly
function applyCombo(board: Board, a: number, b: number, DEBUG = false): Board | null {
  const ta = board[a];
  const tb = board[b];
  if (!ta || !tb) return null;
  if (ta.special === "none" && tb.special === "none") return null;

  // colorbomb + X
  if (ta.special === "colorbomb" || tb.special === "colorbomb") {
    const other = ta.special === "colorbomb" ? tb : ta;
    const next = [...board];

    if (other.special === "colorbomb") {
      // Board wipe
      for (let i = 0; i < next.length; i++) next[i] = null;
      return next;
    }

    if (other.special === "striped-h" || other.special === "striped-v") {
      // Turn all tiles of 'other.id' into striped of random orientation then trigger all
      for (let i = 0; i < next.length; i++) {
        if (next[i]?.id === other.id) {
          next[i] = {
            ...next[i]!,
            special: Math.random() < 0.5 ? "striped-h" : "striped-v",
          };
        }
      }
      // Trigger each striped
      for (let i = 0; i < next.length; i++) {
        if (next[i]?.special === "striped-h" || next[i]?.special === "striped-v") {
          const t = triggerSpecialAt(next, i, DEBUG);
          for (let j = 0; j < next.length; j++) next[j] = t[j];
        }
      }
      return next;
    }

    if (other.special === "wrapped") {
      // Turn all tiles of 'other.id' into wrapped then trigger each
      for (let i = 0; i < next.length; i++) {
        if (next[i]?.id === other.id) {
          next[i] = { ...next[i]!, special: "wrapped" };
        }
      }
      for (let i = 0; i < next.length; i++) {
        if (next[i]?.special === "wrapped") {
          const t = triggerSpecialAt(next, i, DEBUG);
          for (let j = 0; j < next.length; j++) next[j] = t[j];
        }
      }
      return next;
    }

    // colorbomb + normal: clear all of that color
    for (let i = 0; i < next.length; i++) {
      if (next[i]?.id === other.id) next[i] = null;
    }
    next[a] = null;
    next[b] = null;
    return next;
  }

  // striped + striped → row and column clear through the swap spot
  if (
    (ta.special === "striped-h" || ta.special === "striped-v") &&
    (tb.special === "striped-h" || tb.special === "striped-v")
  ) {
    const next = [...board];
    const rA = Math.floor(a / BOARD_SIZE),
      cA = a % BOARD_SIZE;
    const rB = Math.floor(b / BOARD_SIZE),
      cB = b % BOARD_SIZE;
    for (let cc = 0; cc < BOARD_SIZE; cc++) {
      next[idx(rA, cc)] = null;
      next[idx(rB, cc)] = null;
    }
    for (let rr = 0; rr < BOARD_SIZE; rr++) {
      next[idx(rr, cA)] = null;
      next[idx(rr, cB)] = null;
    }
    return next;
  }

  // wrapped + wrapped → large 5x5 explosion around both
  if (ta.special === "wrapped" && tb.special === "wrapped") {
    const boom = (center: number) => {
      const next = [...board];
      const r = Math.floor(center / BOARD_SIZE),
        c = center % BOARD_SIZE;
      for (let rr = r - 2; rr <= r + 2; rr++) {
        for (let cc = c - 2; cc <= c + 2; cc++) {
          if (inBounds(rr, cc)) next[idx(rr, cc)] = null;
        }
      }
      return next;
    };
    let next = boom(a);
    next = boom(b);
    return next;
  }

  // striped + wrapped → cross blast: 3 rows + 3 cols centered on each
  if (
    (ta.special === "striped-h" || ta.special === "striped-v") &&
    tb.special === "wrapped"
  ) {
    const next = [...board];
    const blast = (center: number) => {
      const r = Math.floor(center / BOARD_SIZE),
        c = center % BOARD_SIZE;
      for (let dc = -1; dc <= 1; dc++) {
        for (let cc = 0; cc < BOARD_SIZE; cc++) next[idx(r + dc, cc)] = inBounds(r + dc, cc) ? null : null;
      }
      for (let dr = -1; dr <= 1; dr++) {
        for (let rr = 0; rr < BOARD_SIZE; rr++) next[idx(rr, c + dr)] = inBounds(rr, c + dr) ? null : null;
      }
    };
    blast(a);
    blast(b);
    return next;
  }
  if (
    ta.special === "wrapped" &&
    (tb.special === "striped-h" || tb.special === "striped-v")
  ) {
    return applyCombo(board, b, a, DEBUG);
  }

  return null;
}

// ------------------------------ Component -----------------------------

export default function MonsterMunch() {
  const [board, setBoard] = useState<Board>(() =>
    Array.from({ length: BOARD_SIZE * BOARD_SIZE }, freshTile)
  );
  const [score, setScore] = useState(0);
  const [user, setUser] = useState<any>(null);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [debug, setDebug] = useState(false);
  const busy = useRef(false); // prevent overlapping resolves

  // music/auth init
  useEffect(() => {
    try {
      bgMusic.play();
    } catch {}
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => {
      try {
        bgMusic.stop();
      } catch {}
      unsub();
    };
  }, []);

  // Leaderboard
  const [highscores, setHighscores] = useState<{ name: string; score: number; timestamp: string }[]>(
    []
  );
  async function fetchHighscores() {
    const qy = query(collection(db, "highscores"), orderBy("score", "desc"), limit(5));
    const snapshot = await getDocs(qy);
    setHighscores(
      snapshot.docs.map((d) => d.data() as { name: string; score: number; timestamp: string })
    );
  }
  useEffect(() => {
    fetchHighscores().catch(() => {});
  }, []);
  async function saveHighscore() {
    if (!user) return;
    await addDoc(collection(db, "highscores"), {
      name: user.displayName || "Anonymous",
      score,
      timestamp: new Date().toISOString(),
    });
    fetchHighscores();
  }
  function signIn() {
    signInWithPopup(auth, new GoogleAuthProvider()).catch(() => {});
  }
  function signOutUser() {
    signOut(auth).catch(() => {});
  }

  // Core: resolve cascades until stable
  const resolveAll = async (b: Board) => {
    if (busy.current) return;
    busy.current = true;
    let current = b;
    // loop until no matches
    while (true) {
      const m = detectMatches(current, debug);
      if (!m.length) break;
      current = resolveBoardWithMatches(current, m, setScore, debug);
    }
    setBoard(current);
    busy.current = false;
  };

  // Swap logic with combo handling and validity check (revert if no match/ combo)
  const trySwap = (a: number, b: number) => {
    if (!isAdjacent(a, b)) return;
    if (busy.current) return;

    // Special+Special combo on direct swap
    const combo = applyCombo(board, a, b, debug);
    if (combo) {
      specialSound?.play();
      resolveAll(combo);
      return;
    }

    const copy = [...board];
    [copy[a], copy[b]] = [copy[b], copy[a]];
    // Check if swap created any matches
    const m = detectMatches(copy, debug);
    if (m.length) {
      resolveAll(copy);
    } else {
      // revert swap if no matches
      const back = [...copy];
      [back[a], back[b]] = [back[b], back[a]];
      setBoard(back);
    }
  };

  // Simple click-to-swap selection
  const handleClick = (i: number) => {
    const selected = board.findIndex((t) => t?.selected);
    const next = [...board];
    if (selected === -1) {
      if (next[i]) next[i] = { ...next[i]!, selected: true };
      setBoard(next);
    } else if (selected === i) {
      if (next[i]) next[i] = { ...next[i]!, selected: false };
      setBoard(next);
    } else {
      // attempt swap
      if (next[selected]) next[selected] = { ...next[selected]!, selected: false };
      setBoard(next);
      trySwap(selected, i);
    }
  };

  const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: `repeat(${BOARD_SIZE}, ${TILE_SIZE}px)`,
    gap: 6,
    justifyContent: "center",
    marginTop: 12,
  };

  const TileOverlay = ({ special }: { special: SpecialType }) => {
    if (special === "none") return null;
    const icon =
      special === "striped-h" || special === "striped-v"
        ? "⚡"
        : special === "wrapped"
        ? "💣"
        : "🌈";
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 18,
          fontWeight: 700,
          textShadow: "0 2px 4px rgba(0,0,0,0.35)",
          pointerEvents: "none",
        }}
      >
        {icon}
      </div>
    );
  };

  return (
    <main style={{ padding: 16, textAlign: "center" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 6 }}>Monster Munch (Web)</h1>
      <div style={{ marginBottom: 8 }}>
        <strong>Score:</strong> {score}
      </div>

      <div style={{ marginBottom: 8, display: "flex", gap: 8, justifyContent: "center" }}>
        {user ? (
          <>
            <span>Welcome, {user.displayName || "Player"}!</span>
            <button onClick={signOutUser}>Sign out</button>
            <button onClick={saveHighscore}>Save High Score</button>
          </>
        ) : (
          <button onClick={signIn}>Sign in with Google</button>
        )}
        <label style={{ userSelect: "none" }}>
          <input
            type="checkbox"
            checked={debug}
            onChange={(e) => setDebug(e.target.checked)}
            style={{ marginRight: 6 }}
          />
          Debug Mode
        </label>
      </div>

      <div style={gridStyle}>
        {board.map((tile, i) => {
          const selected = !!tile?.selected;
          return (
            <div
              key={i}
              onClick={() => handleClick(i)}
              draggable
              onDragStart={() => setDragStart(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragStart !== null && dragStart !== i) {
                  trySwap(dragStart, i);
                  setDragStart(null);
                }
              }}
              style={{
                width: TILE_SIZE,
                height: TILE_SIZE,
                background: "#fff",
                borderRadius: 8,
                border: selected ? "3px solid #f43f5e" : "1px solid #d1d5db",
                boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
                position: "relative",
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              {tile && (
                <>
                  <img
                    src={tile.src}
                    alt={tile.id}
                    width={TILE_SIZE - 8}
                    height={TILE_SIZE - 8}
                    style={{ objectFit: "contain", pointerEvents: "none" }}
                  />
                  <TileOverlay special={tile.special} />
                </>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ margin: "16px auto 0", maxWidth: 480, textAlign: "left" }}>
        <h3>🏆 Leaderboard</h3>
        <ul style={{ paddingLeft: 18 }}>
          {highscores.map((h, k) => (
            <li key={k} style={{ marginBottom: 4 }}>
              <strong>{h.name || "Anonymous"}</strong> — {h.score} (
              {new Date(h.timestamp).toLocaleString()})
            </li>
          ))}
        </ul>
      </div>

      {debug && (
        <details style={{ marginTop: 12 }}>
          <summary>Debug Tips</summary>
          <ul>
            <li>Swap two specials directly to test combos.</li>
            <li>Watch the console for <code>detectMatches</code> output.</li>
            <li>Striped icon ⚡, Wrapped 💣, Color Bomb 🌈.</li>
          </ul>
        </details>
      )}
    </main>
  );
}
