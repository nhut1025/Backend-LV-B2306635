const reservationModel = require('../models/reservation.model');

async function suggestTables(req, res, next) {
  try {
    const partySize = Number(req.query.party_size);
    if (!partySize || partySize <= 0) {
      return res.status(400).json({ message: 'Thiếu hoặc sai party_size.' });
    }

    const freeTables = await reservationModel.findFreeTables();
    const combo = reservationModel.suggestTableCombo(freeTables, partySize);

    if (!combo) {
      return res.status(409).json({ message: 'Hiện không đủ bàn trống cho số lượng khách này.' });
    }

    res.json({
      tables: combo,
      is_combined: combo.length > 1,
      total_capacity: combo.reduce((sum, t) => sum + t.capacity, 0),
    });
  } catch (err) {
    next(err);
  }
}

async function createHold(req, res, next) {
  try {
    const userId = req.user.id;
    const { party_size, reservation_date, reservation_time, phone, table_ids } = req.body;

    if (!party_size || !reservation_date || !reservation_time || !phone) {
      return res.status(400).json({ message: 'Thiếu party_size, reservation_date, reservation_time hoặc phone.' });
    }
    if (!Array.isArray(table_ids) || table_ids.length === 0) {
      return res.status(400).json({ message: 'Thiếu table_ids (danh sách bàn đã chọn).' });
    }

    const result = await reservationModel.createHold(userId, {
      partySize: Number(party_size),
      reservationDate: reservation_date,
      reservationTime: reservation_time,
      phone,
      tableIds: table_ids,
    });

    res.status(201).json({
      reservation_id: result.reservationId,
      status: 'giu_tam',
      hold_minutes: result.holdMinutes,
      table_ids: result.tableIds,
    });
  } catch (err) {
    next(err);
  }
}

async function listMine(req, res, next) {
  try {
    const rows = await reservationModel.findMyReservations(req.user.id);
    res.json({ reservations: rows });
  } catch (err) {
    next(err);
  }
}

async function getMineById(req, res, next) {
  try {
    const { id } = req.params;
    const rows = await reservationModel.findMyReservationById(req.user.id, id);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy đặt bàn.' });
    }
    res.json({ reservation: rows[0] });
  } catch (err) {
    next(err);
  }
}

module.exports = { suggestTables, createHold, listMine, getMineById };
