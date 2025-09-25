const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();
app.use(express.json());


app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "http://localhost:3000");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    next();
});

const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error(err.message);
    }
    console.log('Connected to the SQLite database.');
    // Added UNIQUE constraint to prevent duplicate names
    db.run('CREATE TABLE IF NOT EXISTS faces (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, descriptor TEXT)');
});


app.post('/enroll', (req, res) => {
    const { name, descriptor } = req.body;
    const descriptorJson = JSON.stringify(descriptor);
    db.run(`INSERT INTO faces (name, descriptor) VALUES (?, ?)`, [name, descriptorJson], function(err) {
        if (err) {
            console.error(err.message);
            return res.status(500).json({ error: 'Name might already be taken or another error occurred.' });
        }
        res.json({ message: `Enrolled ${name} successfully!` });
    });
});


app.get('/faces', (req, res) => {
    db.all('SELECT name, descriptor FROM faces', [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        const faces = rows.map(row => ({
            label: row.name,
            descriptors: [JSON.parse(row.descriptor)]
        }));
        res.json(faces);
    });
});


app.delete('/delete/:name', (req, res) => {
    const { name } = req.params;
    db.run(`DELETE FROM faces WHERE name = ?`, name, function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (this.changes > 0) {
            res.json({ message: `${name} was successfully deleted.` });
        } else {
            res.status(404).json({ message: `No user named ${name} found.` });
        }
    });
});


const PORT = 3001;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});