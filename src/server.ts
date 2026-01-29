import express from 'express';

const app = express();

// Middleware
app.use(express.json());

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'leadscop-backend' });
});

export default app;
