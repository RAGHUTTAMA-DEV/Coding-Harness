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

document.getElementById('todo-form').addEventListener('submit', function(e) {
    e.preventDefault();
    const input = document.getElementById('todo-input');
    const taskText = input.value.trim();
    if (taskText !== '') {
        addTask(taskText, false);
        input.value = '';
        saveTasks();
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
    document.getElementById('todo-list').appendChild(li);
}

function toggleComplete(checkbox) {
    const li = checkbox.parentElement;
    li.classList.toggle('completed');
    saveTasks();
}

function removeTask(button) {
    button.parentElement.remove();
    saveTasks();
}

function saveTasks() {
    const tasks = Array.from(document.querySelectorAll('#todo-list li')).map(li => ({
        text: li.querySelector('span').textContent,
        completed: li.classList.contains('completed')
    }));
    localStorage.setItem('todoTasks', JSON.stringify(tasks));
}

function loadTasks() {
    const tasks = JSON.parse(localStorage.getItem('todoTasks') || '[]');
    tasks.forEach(t => addTask(t.text, t.completed));
}

window.onload = loadTasks;