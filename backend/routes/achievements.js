const express = require('express');
const { body, param, validationResult } = require('express-validator');
const winston = require('winston');

const achievementPipelineService = require('../services/achievementPipelineService');

const router = express.Router();

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.json(),
    defaultMeta: { service: 'achievements-routes' },
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'logs/achievements.log' }),
    ],
});

/**
 * POST /api/achievements/milestone
 *
 * Reports a completed learning milestone. The badge is awarded locally and
 * immediately (gameplay is never blocked), and an idempotent mint job is
 * queued to verify it on-chain asynchronously.
 *
 * The response is deliberately child-friendly — ZERO crypto vocabulary. The
 * chain / wallet / NFT details live only on the parent dashboard endpoints.
 */
router.post(
    '/milestone',
    [
        body('childId').isString().trim().notEmpty(),
        body('achievementTypeId').isString().trim().notEmpty(),
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ error: 'Validation failed', details: errors.array() });
        }

        try {
            const { childId, achievementTypeId } = req.body;
            const { achievement, alreadyAwarded } = await achievementPipelineService.awardAchievement({
                childId,
                achievementTypeId,
            });

            return res.status(alreadyAwarded ? 200 : 201).json({
                success: true,
                message: 'You earned a badge! 🏆',
                badge: { id: achievement.id, earnedAt: achievement.earnedAt },
                alreadyAwarded,
            });
        } catch (error) {
            logger.error('Failed to award milestone achievement:', error);
            return res.status(500).json({ error: 'Failed to award achievement' });
        }
    }
);

/**
 * GET /api/achievements/:childId/:onChainId/verification
 *
 * Parent-dashboard view: badge verification status ("pending → confirmed")
 * plus a Celoscan "verify on blockchain" link once the mint is confirmed.
 */
router.get(
    '/:childId/:onChainId/verification',
    [param('childId').isString().trim().notEmpty(), param('onChainId').isInt({ min: 0 })],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ error: 'Validation failed', details: errors.array() });
        }

        try {
            const { childId, onChainId } = req.params;
            const verification = await achievementPipelineService.getBadgeVerification(
                childId,
                Number(onChainId)
            );
            return res.status(200).json({ success: true, verification });
        } catch (error) {
            logger.error('Failed to fetch badge verification:', error);
            return res.status(500).json({ error: 'Failed to fetch verification status' });
        }
    }
);

/**
 * POST /api/achievements/mint-queue/process
 *
 * Drains due mint jobs. Intended to be invoked by a scheduled worker
 * (node-cron) or an ops trigger, not directly by children. Reconciles
 * "pending → confirmed" and retries transient RPC failures with backoff.
 */
router.post('/mint-queue/process', [body('limit').optional().isInt({ min: 1, max: 100 })], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    try {
        const limit = req.body.limit ? Number(req.body.limit) : 10;
        const results = await achievementPipelineService.processQueue(limit);
        return res.status(200).json({ success: true, processed: results.length, results });
    } catch (error) {
        logger.error('Failed to process mint queue:', error);
        return res.status(500).json({ error: 'Failed to process mint queue' });
    }
});

module.exports = router;
