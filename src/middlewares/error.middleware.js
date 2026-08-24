
function errorHandler(err, req, res, next) {
  console.error(err);

  const status = err.status || 500;
  const message = err.message || 'Lỗi server, vui lòng thử lại sau.';

  res.status(status).json({ message });
}

function notFoundHandler(req, res) {
  res.status(404).json({ message: 'Không tìm thấy route này.' });
}

module.exports = { errorHandler, notFoundHandler };
