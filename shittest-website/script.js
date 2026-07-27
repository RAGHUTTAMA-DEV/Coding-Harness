const themeToggle = document.getElementById('theme-toggle');

themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark');
    themeToggle.textContent = document.body.classList.contains('dark') ? '☀️' : '🌙';
    localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
});

// Load theme
if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark');
    themeToggle.textContent = '☀️';
}

document.getElementById('shittest-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    const input = document.getElementById('shittest-input');
    const taskText = input.value.trim();
    if (taskText !== '') {
        const response = await fetch('http://localhost:3000/todos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task: taskText })
        });
        if (response.ok) {
            const newTodo = await response.json();
            addTask(newTodo.task, newTodo.completed);
            input.value = '';
        }
    }
});

function addTask(text, completed) {
    const li = document.createElement('li');
    li.innerHTML = `
        <input type="checkbox" ${completed ? 'checked' : ''} onchange="toggleComplete(this)">
        <span>${text}</span>
        <button onclick="removeTask(this)">Delete</button>
    `;
    if (completed) li.classList.add('completed');
    document.getElementById('shittest-list').appendChild(li);
}

function toggleComplete(checkbox) {
    checkbox.parentElement.classList.toggle('completed');
}

function removeTask(button) {
    button.parentElement.remove();
}

async function loadTasks() {
    const response = await fetch('http://localhost:3000/todos');
    const tasks = await response.json();
    tasks.forEach(t => addTask(t.task, t.completed));
}

window.onload = loadTasks;
