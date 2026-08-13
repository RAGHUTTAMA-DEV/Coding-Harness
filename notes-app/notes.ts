import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const NOTES_FILE = resolve('notes-app/notes.json');

interface Note {
  id: number;
  content: string;
  timestamp: string;
}

function loadNotes(): Note[] {
  if (!existsSync(NOTES_FILE)) return [];
  return JSON.parse(readFileSync(NOTES_FILE, 'utf-8'));
}

function saveNotes(notes: Note[]) {
  writeFileSync(NOTES_FILE, JSON.stringify(notes, null, 2));
}

const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/') return new Response(Bun.file('notes-app/index.html'));
    
    if (url.pathname === '/api/notes') {
      if (req.method === 'GET') return Response.json(loadNotes());
      if (req.method === 'POST') {
        const { content } = await req.json();
        const notes = loadNotes();
        notes.push({ id: Date.now(), content, timestamp: new Date().toISOString() });
        saveNotes(notes);
        return new Response('Added', { status: 201 });
      }
    }
    
    if (url.pathname.startsWith('/api/notes/')) {
      if (req.method === 'DELETE') {
        const id = parseInt(url.pathname.split('/').pop() || '');
        const notes = loadNotes().filter(n => n.id !== id);
        saveNotes(notes);
        return new Response('Deleted');
      }
    }
    
    return new Response('Not Found', { status: 404 });
  },
});

console.log(`Server running at http://localhost:${server.port}`);
