function errorHandler(err, req, res, _next) {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}:`, err.message);

  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Internal server error',
    path: req.path
  });
}

module.exports = errorHandler;
