// Apply this after authentication to any premium API route (analytics, non-classic modes, and unlimited hints).
module.exports = async function requirePremium(req, res, next) {
  if (req.user?.subscriptionType === 'PREMIUM' || req.user?.subscriptionType === 'SCHOOL') return next();
  return res.status(403).json({ error: 'Premium subscription required' });
};
