document.getElementById('todo-form').addEventListener('submit', function(e) {
    e.preventDefault();
    const input = document.getElementById('todo-input');
    const taskText = input.value.trim();
    if (taskText !== '') {
        const li = document.createElement('li');
        li.innerHTML = `
            ${taskText}
            <button onclick="toggleComplete(this)">✓</button>
            <button onclick="removeTask(this)">✖</button>
        `;
        document.getElementById('todo-list').appendChild(li);
        input.value = '';
        saveTasks();
    }
});

function toggleComplete(button) {
    const li = button.parentElement;
    li.classList.toggle('completed');
    saveTasks();
}

function removeTask(button) {
    const li = button.parentElement;
    li.remove();
    saveTasks();
}

function saveTasks() {
    const tasks = document.querySelectorAll('#todo-list li');
    const taskData = Array.from(tasks).map(task => ({
        text: task.firstChild.textContent,
        completed: task.classList.contains('completed')
    }));
    localStorage.setItem('todoTasks', JSON.stringify(taskData));
}

function loadTasks() {
    const taskData = JSON.parse(localStorage.getItem('todoTasks') || '[]');
    taskData.forEach(task => {
        const li = document.createElement('li');
        li.innerHTML = `
            ${task.text}
            <button onclick="toggleComplete(this)">✓</button>
            <button onclick="removeTask(this)">✖</button>
        `;
        if (task.completed) {
            li.classList.add('completed');
        }
        document.getElementById('todo-list').appendChild(li);
    });
}

// Load tasks when page loads
// Dark mode toggle functionality
const toggle = document.getElementById('theme-toggle');
const container = document.querySelector('.container');

// Load saved theme preference
const savedTheme = localStorage.getItem('theme') || 'light';
if (savedTheme === 'dark') {
  document.documentElement.classList.add('dark');
  container.classList.add('dark');
  toggle.classList.add('dark');
}

// Toggle theme
toggle.addEventListener('click', () => {
  const isDark = document.documentElement.classList.toggle('dark');
  const isContainerDark = container.classList.toggle('dark');
  const isToggleDark = toggle.classList.toggle('dark');
  
  // Save preference
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
});

// Optional: Add smooth transition effect
// document.documentElement.classList.add('transition');

// Load tasks when page loads
window.onload = loadTasks;