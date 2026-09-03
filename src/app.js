
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth.routes');
const healthRoutes = require('./routes/health.routes');
const ingredientRoutes = require('./routes/ingredient.routes');
const dishRoutes = require('./routes/dish.routes');
const tableRoutes = require('./routes/table.routes');
const userRoutes = require('./routes/user.routes');
const reservationRoutes = require('./routes/reservation.routes');
const { notFoundHandler, errorHandler } = require('./middlewares/error.middleware');

const app = express();

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api', healthRoutes);
app.use('/api/ingredients', ingredientRoutes);
app.use('/api/dishes', dishRoutes);
app.use('/api/tables', tableRoutes);
app.use('/api/users', userRoutes);
app.use('/api/reservations', reservationRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
