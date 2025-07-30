
// ✅ Monster Munch index.tsx with working special match logic
// NOTE: Replace firebaseConfig with your own values from Firebase Console

import React, { useEffect, useState } from 'react';
import { Howl } from 'howler';
import { initializeApp } from 'firebase/app';
import { getAnalytics } from "firebase/analytics";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut
} from 'firebase/auth';
import {
  getFirestore, collection, addDoc, getDocs, query, orderBy, limit
} from 'firebase/firestore';

type MonsterTile = {
  id: string;
  src: string;
  special?: 'row' | 'column' | 'bomb' | 'none';
  selected?: boolean;
};

const firebaseConfig = {
  apiKey: "AIzaSyAdEJUglq1FRu5gEcYz5a7ARRFXsn1OYv8",
  authDomain: "monster-munch-39f02.firebaseapp.com",
  projectId: "monster-munch-39f02",
  storageBucket: "monster-munch-39f02.firebasestorage.app",
  messagingSenderId: "1082967910959",
  appId: "1:1082967910959:web:289d9a56184f03a992b4da",
  measurementId: "G-58ZLRH2P86"
};
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);

const BOARD_SIZE = 8;
const MONSTERS: MonsterTile[] = [
  { id: 'blue', src: '/monsters/blue.png', special: 'row' },
  { id: 'pink', src: '/monsters/pink.png', special: 'bomb' },
  { id: 'green', src: '/monsters/green.png', special: 'column' },
  { id: 'yellow', src: '/monsters/yellow.png', special: 'none' },
  { id: 'purple', src: '/monsters/purple.png', special: 'none' }
];

const matchSound = new Howl({ src: ['/sounds/match.mp3'] });
const bgMusic = new Howl({ src: ['/sounds/bg-composed.mp3'], loop: true, volume: 0.5 });

function getRandomMonster(): MonsterTile {
  const base = MONSTERS[Math.floor(Math.random() * MONSTERS.length)];
  return { ...base, selected: false };
}

function generateBoard(): MonsterTile[] {
  return Array.from({ length: BOARD_SIZE * BOARD_SIZE }, getRandomMonster);
}

export default function Home() {
  const [board, setBoard] = useState<MonsterTile[]>(generateBoard);
  const [score, setScore] = useState(0);
  const [user, setUser] = useState<any>(null);
  const [highscores, setHighscores] = useState<any[]>([]);

  useEffect(() => {
    bgMusic.play();
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    fetchHighscores();
    return () => {
      bgMusic.stop();
      unsub();
    };
  }, []);

  async function fetchHighscores() {
    const q = query(collection(db, 'highscores'), orderBy('score', 'desc'), limit(5));
    const snapshot = await getDocs(q);
    const list = snapshot.docs.map(doc => doc.data());
    setHighscores(list);
  }

  async function saveHighscore() {
    if (!user) return;
    await addDoc(collection(db, 'highscores'), {
      name: user.displayName || 'Anonymous',
      score,
      timestamp: new Date().toISOString()
    });
    fetchHighscores();
  }

  function signIn() {
    const provider = new GoogleAuthProvider();
    signInWithPopup(auth, provider);
  }

  function signOutUser() {
    signOut(auth);
  }

  function clearTile(i: number, newBoard: MonsterTile[]) {
    if (newBoard[i]) {
      newBoard[i] = null!;
      setScore(prev => prev + 10);
      matchSound.play();
    }
  }

  function applySpecial(i: number, special: string | undefined, newBoard: MonsterTile[]) {
    if (!special || special === "none") return;

    if (special === "row") {
      const rowStart = i - (i % BOARD_SIZE);
      for (let j = rowStart; j < rowStart + BOARD_SIZE; j++) {
        clearTile(j, newBoard);
      }
    } else if (special === "column") {
      for (let j = i % BOARD_SIZE; j < BOARD_SIZE * BOARD_SIZE; j += BOARD_SIZE) {
        clearTile(j, newBoard);
      }
    } else if (special === "bomb") {
      const neighbors = [
        -BOARD_SIZE - 1, -BOARD_SIZE, -BOARD_SIZE + 1,
        -1, 0, 1,
        BOARD_SIZE - 1, BOARD_SIZE, BOARD_SIZE + 1
      ];
      neighbors.forEach(offset => {
        const index = i + offset;
        if (index >= 0 && index < BOARD_SIZE * BOARD_SIZE) {
          clearTile(index, newBoard);
        }
      });
    }
  }

  function checkMatches(b: MonsterTile[]) {
    const newBoard = [...b];
    let matched = false;

    for (let i = 0; i < BOARD_SIZE * BOARD_SIZE; i++) {
      const row = Math.floor(i / BOARD_SIZE);
      const col = i % BOARD_SIZE;
      if (!b[i]) continue;
      const current = b[i].id;

      if (
        col < BOARD_SIZE - 2 &&
        b[i + 1]?.id === current &&
        b[i + 2]?.id === current
      ) {
        matched = true;
        applySpecial(i, b[i].special, newBoard);
        applySpecial(i + 1, b[i + 1].special, newBoard);
        applySpecial(i + 2, b[i + 2].special, newBoard);
      }

      if (
        row < BOARD_SIZE - 2 &&
        b[i + BOARD_SIZE]?.id === current &&
        b[i + BOARD_SIZE * 2]?.id === current
      ) {
        matched = true;
        applySpecial(i, b[i].special, newBoard);
        applySpecial(i + BOARD_SIZE, b[i + BOARD_SIZE].special, newBoard);
        applySpecial(i + BOARD_SIZE * 2, b[i + BOARD_SIZE * 2].special, newBoard);
      }
    }

    if (matched) {
      setTimeout(() => dropMonsters(newBoard), 200);
    }
  }

  function dropMonsters(newBoard: MonsterTile[]) {
    const dropped = [...newBoard];
    for (let i = BOARD_SIZE * BOARD_SIZE - 1; i >= 0; i--) {
      if (!dropped[i]) {
        let j = i - BOARD_SIZE;
        while (j >= 0 && !dropped[j]) j -= BOARD_SIZE;
        if (j >= 0) {
          dropped[i] = dropped[j];
          dropped[j] = null!;
        } else {
          dropped[i] = getRandomMonster();
        }
      }
    }
    setBoard(dropped);
  }

  useEffect(() => {
    const interval = setInterval(() => checkMatches(board), 500);
    return () => clearInterval(interval);
  }, [board]);

  function swap(i: number, j: number) {
    const newBoard = [...board];
    [newBoard[i], newBoard[j]] = [newBoard[j], newBoard[i]];
    setBoard(newBoard);
  }

  return (
    <main style={{ textAlign: 'center', padding: 20 }}>
      <h1>Monster Munch</h1>
      {user ? (
        <>
          <p>Welcome, {user.displayName}</p>
          <button onClick={signOutUser}>Sign Out</button>
        </>
      ) : (
        <button onClick={signIn}>Sign in with Google</button>
      )}
      <p>Score: {score}</p>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${BOARD_SIZE}, 40px)`,
        gap: 2,
        justifyContent: 'center',
        marginTop: 10
      }}>
        {board.map((tile, i) => (
          <div key={i}
            onClick={() => {
              const selected = board.findIndex((_, idx) => idx !== i && board[idx]?.selected);
              if (selected !== -1) {
                swap(i, selected);
                board[selected].selected = false;
              } else {
                board[i].selected = true;
              }
            }}
            style={{
              width: 40, height: 40,
              backgroundColor: 'white',
              border: tile?.selected ? '2px solid red' : '1px solid #ccc',
              borderRadius: 4,
              overflow: 'hidden'
            }}>
            {tile && <img src={tile.src} alt={tile.id} width={40} height={40} />}
          </div>
        ))}
      </div>

      {user && (
        <button onClick={saveHighscore} style={{ marginTop: 20 }}>
          Save High Score
        </button>
      )}

      <h2 style={{ marginTop: 30 }}>🏆 Leaderboard</h2>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {highscores.map((entry, i) => (
          <li key={i}>{entry.name} - {entry.score}</li>
        ))}
      </ul>
    </main>
  );
}
