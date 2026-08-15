const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'notes.json');

app.use(cors());
app.use(express.json());

const readNotes = () => {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
};

const writeNotes = (notes) => {
    fs.writeFileSync(DATA_FILE, JSON.stringify(notes, null, 2));
};

app.get('/notes', (req, res) => {
    res.json(readNotes());
});

app.post('/notes', (req, res) => {
    const notes = readNotes();
    const newNote = { id: Date.now(), text: req.body.text };
    notes.push(newNote);
    writeNotes(notes);
    res.status(201).json(newNote);
});

app.delete('/notes/:id', (req, res) => {
    let notes = readNotes();
    notes = notes.filter(n => n.id !== parseInt(req.params.id));
    writeNotes(notes);
    res.status(204).send();
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
