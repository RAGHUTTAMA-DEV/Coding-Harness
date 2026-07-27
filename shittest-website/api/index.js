const express = require('express');
const cors = require('cors');
const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

let todos = [
    { id: 1, task: 'Learn Backend', completed: false },
    { id: 2, task: 'Fix Frontend', completed: true }
];

app.get('/todos', (req, res) => {
    res.json(todos);
});

app.post('/todos', (req, res) => {
    const { task } = req.body;
    const newTodo = { id: Date.now(), task, completed: false };
    todos.push(newTodo);
    res.status(201).json(newTodo);
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
