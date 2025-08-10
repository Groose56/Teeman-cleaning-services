require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const path = require('path');
const nodemailer = require('nodemailer');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

/* ---------------- DATABASE CONNECTION ---------------- */
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

pool.getConnection()
    .then(conn => {
        console.log('✅ Connected to MySQL');
        conn.release();
    })
    .catch(err => {
        console.error('❌ MySQL connection error:', err.message);
        process.exit(1);
    });

/* ---------------- SESSION STORE ---------------- */
const sessionStore = new MySQLStore({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

/* ---------------- MIDDLEWARE ---------------- */
app.use(cors({
    origin: 'https://your-frontend-domain.com', // CHANGE to your frontend domain
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: process.env.SESSION_SECRET,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 86400000, // 1 day
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'none' // Required for cross-domain cookies
    }
}));

/* ---------------- AUTH MIDDLEWARE ---------------- */
function isAuthenticated(req, res, next) {
    if (req.session.isAdmin) {
        return next();
    }
    res.redirect('/login.html'); // Redirect to login instead of JSON
}

/* ---------------- ROUTES ---------------- */
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    let connection;

    try {
        connection = await pool.getConnection();
        const [rows] = await connection.execute(
            'SELECT * FROM admins WHERE username = ?', [username]
        );

        if (rows.length === 0) {
            return res.status(401).json({ message: 'Invalid username or password.' });
        }

        const admin = rows[0];
        const isMatch = await bcrypt.compare(password, admin.password_hash);

        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid username or password.' });
        }

        req.session.isAdmin = true;
        req.session.userId = admin.admin_id;

        req.session.save(err => {
            if (err) {
                console.error('Session save error:', err);
                return res.status(500).json({ message: 'Session error.' });
            }
            res.status(200).json({ message: 'Login successful!' });
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Server error during login.' });
    } finally {
        if (connection) connection.release();
    }
});

app.post('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).json({ message: 'Logout failed.' });
        }
        res.clearCookie('connect.sid');
        res.status(200).json({ message: 'Logged out.' });
    });
});

app.get('/admin_panel.html', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin_panel.html'));
});

app.get('/', (req, res) => {
    res.redirect('/login.html');
});

/* ---------------- START SERVER ---------------- */
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
