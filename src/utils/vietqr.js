// src/utils/vietqr.js
//
// Dựng URL ảnh QR chuyển khoản chuẩn VietQR — dịch vụ công khai, miễn phí,
// không cần đăng ký/API key. Xem thêm: https://www.vietqr.io/danh-sach-api/

function buildVietQrUrl({ bankBin, accountNumber, amount, addInfo, accountName }) {
  const base = `https://img.vietqr.io/image/${bankBin}-${accountNumber}-qr_only.png`;
  const params = new URLSearchParams({
    amount: String(amount),
    addInfo,
    accountName,
  });
  return `${base}?${params.toString()}`;
}

module.exports = { buildVietQrUrl };