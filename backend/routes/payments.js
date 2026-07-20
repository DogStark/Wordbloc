const express = require('express');
const jwt = require('jsonwebtoken');
const { verifyMessage, getAddress, isAddress } = require('ethers');
const { PrismaClient } = require('@prisma/client');
const { EntitlementService } = require('../services/entitlementService');

const router = express.Router();
const prisma = new PrismaClient();
const entitlements = new EntitlementService({ prisma });
const challenges = new Map();
function userId(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new Error('Authentication required');
  return jwt.verify(token, process.env.JWT_SECRET).userId;
}
router.get('/wallet/challenge', (req, res) => {
  try {
    const id = userId(req); const nonce = crypto.randomUUID();
    const message = `SpellBloc wallet link\nAccount: ${id}\nNonce: ${nonce}`;
    challenges.set(id, { message, expires: Date.now() + 5 * 60 * 1000 });
    res.json({ message });
  } catch (_) { res.status(401).json({ error: 'Authentication required' }); }
});
router.post('/wallet/link', express.json(), async (req, res) => {
  try {
    const id = userId(req); const challenge = challenges.get(id);
    if (!challenge || challenge.expires < Date.now()) return res.status(400).json({ error: 'Wallet challenge expired. Request a new one.' });
    if (!isAddress(req.body.address) || !req.body.signature) return res.status(400).json({ error: 'A valid wallet address and signature are required.' });
    if (getAddress(verifyMessage(challenge.message, req.body.signature)) !== getAddress(req.body.address)) return res.status(403).json({ error: 'Signature does not prove ownership of this wallet.' });
    challenges.delete(id);
    const wallet = await prisma.paymentWallet.upsert({ where: { userId: id }, update: { address: getAddress(req.body.address) }, create: { userId: id, address: getAddress(req.body.address) } });
    res.json({ address: wallet.address });
  } catch (error) { res.status(400).json({ error: error.message || 'Could not link wallet.' }); }
});
router.post('/sync', async (req, res) => {
  try { res.json(await entitlements.syncUser(userId(req))); }
  catch (error) { res.status(error.message.includes('Authentication') ? 401 : 503).json({ error: error.message }); }
});
module.exports = { router, entitlements };
