type MonsterTile = {
  id: string;
  src: string;
  selected?: boolean;
};

import React, { useEffect, useState } from 'react';
import { Howl } from 'howler';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "monster-munch.firebaseapp.com",
  projectId: "monster-munch",
  storageBucket: "monster-munch.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const BOARD_SIZE = 8;
const MONSTERS = [
  { id: 'blue', src: '/monsters/blue.png' },
  { id: 'pink', src: '/monsters/pink.png' },
  { id: 'green', src: '/monsters/green.png' },
  { id: 'yellow', src: '/monsters/yellow.png' },
  { id: 'purple', src: '/monsters/purple.png' }
];

const matchSound = new Howl({ src: ['/sounds/match.mp3'] });
const bgMusic = new Howl({ src: ['/sounds/bg-composed.mp3'], loop: true, volume: 0.5 });

function getRandomMonster() {
  return MONSTERS[Math.floor(Math.random() * MONSTERS.length)];
}

function generateBoard(): MonsterTile[] {
  return Array.from({ length: BOARD_SIZE * BOARD_SIZE }, () => ({ ...getRandomMonster(), selected: false }));
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

  function swap(i: number, j: number) {
    const newBoard = [...board];
    [newBoard[i], newBoard[j]] = [newBoard[j], newBoard[i]];
    setBoard(newBoard);
    checkMatches(newBoard);
  }

  function clearTile(i: number, newBoard: any[]) {
    newBoard[i] = null;
    setScore(prev => prev + 10);
    matchSound.play();
  }

  function checkMatches(b: any[]) {
    const newBoard = [...b];
    let matched = false;
    for (let i = 0; i < BOARD_SIZE * BOARD_SIZE; i++) {
      const row = Math.floor(i / BOARD_SIZE);
      const col = i % BOARD_SIZE;
      if (!newBoard[i]) continue;
      const current = newBoard[i].id;

      if (col < BOARD_SIZE - 2 &&
          newBoard[i + 1]?.id === current &&
          newBoard[i + 2]?.id === current) {
        matched = true;
        clearTile(i, newBoard);
        clearTile(i + 1, newBoard);
        clearTile(i + 2, newBoard);
      }

      if (row < BOARD_SIZE - 2 &&
          newBoard[i + BOARD_SIZE]?.id === current &&
          newBoard[i + BOARD_SIZE * 2]?.id === current) {
        matched = true;
        clearTile(i, newBoard);
        clearTile(i + BOARD_SIZE, newBoard);
        clearTile(i + BOARD_SIZE * 2, newBoard);
      }
    }

    if (matched) {
      setTimeout(() => dropMonsters(newBoard), 200);
    }
  }

  function dropMonsters(newBoard: any[]) {
    let dropped = [...newBoard];
    for (let i = BOARD_SIZE * BOARD_SIZE - 1; i >= 0; i--) {
      if (!dropped[i]) {
        let j = i - BOARD_SIZE;
        while (j >= 0 && !dropped[j]) j -= BOARD_SIZE;
        if (j >= 0) {
          dropped[i] = dropped[j];
          dropped[j] = null;
        } else {
          dropped[i] = getRandomMonster();
        }
      }
    }
    setBoard(dropped);
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

