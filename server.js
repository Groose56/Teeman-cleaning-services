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
// Choose correct host depending on environment
const DB_HOST =
  process.env.NODE_ENV === 'production'
    ? 'mysql.railway.internal' // Internal host for Railway
    : process.env.DB_HOST;     // Local or external

const pool = mysql.createPool({
  host: DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

pool.getConnection()
  .then(connection => {
    console.log('✅ Successfully connected to MySQL database!');
    connection.release();
  })
  .catch(err => {
    console.error('❌ Error connecting to MySQL database:', err.message);
    process.exit(1);
  });

/* ---------------- SESSION STORE ---------------- */
const sessionStore = new MySQLStore({
  host: DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  expiration: 86400000,
  clearExpired: true,
  checkExpirationInterval: 86400000,
  createDatabaseTable: true
}, pool);

/* ---------------- MIDDLEWARE ---------------- */
app.use(cors({
  origin: process.env.CLIENT_URL || '*', // Allow all or set your frontend URL
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
    maxAge: 86400000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production'
  }
}));

/*function isAuthenticated(req, res, next) {
  if (req.session.isAdmin) {
    return next();
  }
  res.status(401).json({ message: 'Unauthorized. Please log in.' });
}*/

/* ---------------- ROUTES ---------------- */
// Serve login page
app.get('/login.html', (req, res) => {
  if (req.session.isAdmin) {
    return res.redirect('/admin.html');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Handle login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  let connection;

  try {
    connection = await pool.getConnection();
    const [rows] = await connection.execute('SELECT * FROM admins WHERE username = ?', [username]);

    if (rows.length === 0) {
      return res.status(401).json({ message: 'Invalid username or password.' });
    }

    const admin = rows[0];
    const isMatch = await bcrypt.compare(password, admin.password_hash);

    if (isMatch) {
      req.session.isAdmin = true;
      req.session.userId = admin.admin_id;
      res.status(200).json({ message: 'Login successful!' });
    } else {
      res.status(401).json({ message: 'Invalid username or password.' });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login.' });
  } finally {
    if (connection) connection.release();
  }
});

// Logout
app.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Error destroying session:', err);
      return res.status(500).json({ message: 'Failed to logout.' });
    }
    res.clearCookie('connect.sid');
    res.status(200).json({ message: 'Logged out successfully.' });
  });
});

// Admin panel
app.get('/admin.html', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin_panel.html'));
});

// Redirect root
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

/* ---------------- DASHBOARD SUMMARY ---------------- */
app.get('/api/dashboard-summary', isAuthenticated, async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const [total] = await connection.execute(`SELECT COUNT(*) AS count FROM bookings`);
    const [pending] = await connection.execute(`SELECT COUNT(*) AS count FROM bookings WHERE IFNULL(status, 'Pending') = 'Pending'`);
    const [completed] = await connection.execute(`SELECT COUNT(*) AS count FROM bookings WHERE status = 'Completed'`);

    res.json({
      totalBookings: total[0].count || 0,
      pendingBookings: pending[0].count || 0,
      completedBookings: completed[0].count || 0
    });
  } catch (error) {
    console.error('Error fetching dashboard summary:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard summary.' });
  } finally {
    if (connection) connection.release();
  }
});

/* ---------------- FETCH BOOKINGS ---------------- */
app.get('/api/bookings', isAuthenticated, async (req, res) => {
  const { search, service, status, date, limit } = req.query;
  let query = `
    SELECT booking_id, first_name, last_name, email, phone_number, address, service_type, message, 
    COALESCE(booking_date, created_at) AS booking_date, IFNULL(status, 'Pending') AS status
    FROM bookings WHERE 1=1`;
  const params = [];

  if (search) {
    query += ' AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR phone_number LIKE ?)';
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm, searchTerm, searchTerm);
  }
  if (service) {
    query += ' AND service_type = ?';
    params.push(service);
  }
  if (status) {
    query += ' AND IFNULL(status,"Pending") = ?';
    params.push(status);
  }
  if (date) {
    query += ' AND DATE(booking_date) = ?';
    params.push(date);
  }

  query += ' ORDER BY COALESCE(booking_date, created_at) DESC, booking_id DESC';

  if (limit) {
    query += ' LIMIT ?';
    params.push(parseInt(limit));
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const [rows] = await connection.execute(query, params);
    res.json(rows);
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ message: 'Failed to fetch bookings.' });
  } finally {
    if (connection) connection.release();
  }
});

/* ---------------- FETCH SINGLE BOOKING ---------------- */
app.get('/api/bookings/:id', isAuthenticated, async (req, res) => {
  const { id } = req.params;
  let connection;
  try {
    connection = await pool.getConnection();
    const [rows] = await connection.execute('SELECT * FROM bookings WHERE booking_id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Booking not found.' });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching single booking:', error);
    res.status(500).json({ message: 'Failed to fetch booking details.' });
  } finally {
    if (connection) connection.release();
  }
});

/* ---------------- UPDATE BOOKING STATUS ---------------- */
app.put('/api/bookings/:id', isAuthenticated, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status || !['Pending', 'In Progress', 'Completed', 'Cancelled'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status provided.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const [result] = await connection.execute('UPDATE bookings SET status = ? WHERE booking_id = ?', [status, id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Booking not found or no changes made.' });
    }
    res.json({ success: true, message: 'Booking status updated successfully.' });
  } catch (error) {
    console.error('Error updating booking status:', error);
    res.status(500).json({ message: 'Failed to update booking status.' });
  } finally {
    if (connection) connection.release();
  }
});

/* ---------------- SEND EMAIL FUNCTION ---------------- */
async function sendEmail(to, subject, htmlContent) {
  try {
    let transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: `"Teeman Cleaning Services" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html: htmlContent
    });

    console.log(`✅ Email sent to ${to}`);
  } catch (error) {
    console.error("❌ Error sending email:", error);
  }
}

/* ---------------- CREATE NEW BOOKING WITH EMAIL ---------------- */
app.post('/api/bookings', async (req, res) => {
  const { first_name, last_name, email, phone_number, address, service_type, message, booking_date } = req.body;

  if (!first_name || !email || !phone_number || !service_type || !booking_date) {
    return res.status(400).json({ message: 'Missing required booking information.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const [result] = await connection.execute(
      `INSERT INTO bookings (first_name, last_name, email, phone_number, address, service_type, message, booking_date, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', NOW())`,
      [first_name, last_name, email, phone_number, address, service_type, message, booking_date]
    );

    // Send notification emails
    await sendEmail(
      process.env.EMAIL_USER,
      "📩 New Booking Received",
      `<h2>New Booking Alert</h2>
       <p><strong>Name:</strong> ${first_name} ${last_name}</p>
       <p><strong>Service:</strong> ${service_type}</p>
       <p><strong>Date:</strong> ${booking_date}</p>
       <p><strong>Message:</strong> ${message}</p>`
    );

    await sendEmail(
      email,
      "✅ Booking Confirmation - Teeman Services",
      `<h2>Thank You for Booking With Us!</h2>
       <p>Hello ${first_name},</p>
       <p>We have received your booking for <strong>${service_type}</strong> on <strong>${booking_date}</strong>.</p>
       <p>Our team will contact you soon to confirm the details.</p>
       <p>Best Regards,<br>Teeman Cleaning Services</p>`
    );

    res.status(201).json({ message: 'Booking created successfully and email sent!', bookingId: result.insertId });

  } catch (error) {
    console.error('Booking submission error:', error);
    res.status(500).json({ message: 'Failed to create booking.' });
  } finally {
    if (connection) connection.release();
  }
});

/* ---------------- START SERVER ---------------- */
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

