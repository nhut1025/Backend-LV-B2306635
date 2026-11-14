const recommendationModel = require('../models/recommendation.model');

async function list(req, res, next) {
  try {
    const requestedModel = req.query.model || 'popularity';
    const limit = req.query.limit === undefined ? 10 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({ message: 'limit phải là số nguyên từ 1 đến 100.' });
    }
    if (!recommendationModel.ALLOWED_MODELS.has(requestedModel)) {
      return res.status(400).json({
        message: 'model phải là popularity hoặc content_based.',
      });
    }
    if (requestedModel === 'content_based') {
      return res.status(400).json({
        message: 'Content-based là gợi ý cá nhân; hãy dùng GET /api/recommendations/me.',
      });
    }

    const customerId = req.user && req.user.role === 'customer'
      ? req.user.id
      : null;
    const recommendations = await recommendationModel.listGlobalRecommendations(
      requestedModel,
      limit,
      customerId
    );
    res.json({ model: requestedModel, recommendations });
  } catch (err) {
    next(err);
  }
}

async function listMine(req, res, next) {
  try {
    const requestedModel = req.query.model || 'content_based';
    const limit = req.query.limit === undefined ? 10 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({ message: 'limit phải là số nguyên từ 1 đến 100.' });
    }
    if (!recommendationModel.ALLOWED_MODELS.has(requestedModel)) {
      return res.status(400).json({
        message: 'model phải là popularity hoặc content_based.',
      });
    }

    if (requestedModel === 'popularity') {
      const recommendations = await recommendationModel.listGlobalRecommendations(
        requestedModel,
        limit,
        req.user.id
      );
      return res.json({ model: requestedModel, recommendations });
    }

    const recommendations = await recommendationModel.listUserRecommendations(
      req.user.id,
      'content_based',
      limit
    );
    if (recommendations.length > 0) {
      return res.json({ model: 'content_based', recommendations });
    }

    const popularRecommendations = await recommendationModel.listGlobalRecommendations(
      'popularity',
      limit,
      req.user.id
    );
    res.json({ model: 'popularity', recommendations: popularRecommendations });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, listMine };
