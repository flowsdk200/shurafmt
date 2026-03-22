import logger from '../utils/logger.js'
import { getCollection } from './mongo.js'

class AfkDatabase {
    constructor() {
        this._col = null
        this._initialized = false
        this.DEFAULT_COOLDOWN = 10 * 1000
    }

    async init() {
        try {
            if (this._initialized) return
            this._col = await getCollection('afk')
            await this._col.createIndex({ userId: 1, groupId: 1 }, { unique: true })
            this._initialized = true
            logger.ready('AFK ready')
        } catch (err) {
            logger.error(`AFK init failed: ${err.message}`)
            throw err
        }
    }

    async _ensure() {
        if (!this._initialized) await this.init()
    }

    async setAfk({ userId, groupId, username, reason, startAt = new Date(), notifyCooldown = this.DEFAULT_COOLDOWN }) {
        try {
            await this._ensure()
            const doc = {
                userId,
                groupId,
                username: String(username || userId.split('@')[0]),
                reason: String(reason || 'Tidak ada alasan'),
                startAt: new Date(startAt),
                lastNotifiedAt: new Date(0),
                notifyCooldown: Number(notifyCooldown) || this.DEFAULT_COOLDOWN
            }
            await this._col.updateOne({ userId, groupId }, { $set: doc }, { upsert: true })
            return doc
        } catch (err) {
            logger.error(`AFK setafk failed (${userId} @ ${groupId}): ${err.message}`)
            throw err
        }
    }

    async getAfk(userId, groupId, projection = {}) {
        try {
            await this._ensure()
            return this._col.findOne({ userId, groupId }, { projection })
        } catch (err) {
            logger.error(`AFK getafk failed (${userId} @ ${groupId}): ${err.message}`)
            throw err
        }
    }

    async getMany(groupId, userIds = [], projection = {}) {
        try {
            await this._ensure()
            if (!Array.isArray(userIds) || !userIds.length) return []
            return this._col.find({ groupId, userId: { $in: userIds } }, { projection }).toArray()
        } catch (err) {
            logger.error(`AFK getmany failed (${groupId}): ${err.message}`)
            throw err
        }
    }

    async clearAfk(userId, groupId) {
        try {
            await this._ensure()
            await this._col.deleteOne({ userId, groupId })
        } catch (err) {
            logger.error(`AFK clearafk failed (${userId} @ ${groupId}): ${err.message}`)
            throw err
        }
    }

    async clearMany(groupId, userIds = []) {
        try {
            await this._ensure()
            if (!Array.isArray(userIds) || !userIds.length) return
            await this._col.deleteMany({ groupId, userId: { $in: userIds } })
        } catch (err) {
            logger.error(`AFK clearmany failed (${groupId}): ${err.message}`)
            throw err
        }
    }

    async tryMarkNotified(record, now = Date.now()) {
        try {
            await this._ensure()
            if (!record) return false
            const cooldown = Number(record.notifyCooldown) || this.DEFAULT_COOLDOWN
            const threshold = new Date(now - cooldown)

            const res = await this._col.updateOne(
                {
                    userId: record.userId,
                    groupId: record.groupId,
                    $or: [
                        { lastNotifiedAt: { $exists: false } },
                        { lastNotifiedAt: { $lte: threshold } }
                    ]
                },
                { $set: { lastNotifiedAt: new Date(now) } }
            )

            return res.modifiedCount > 0
        } catch (err) {
            logger.error(`AFK trymarknotified failed (${record?.userId} @ ${record?.groupId}): ${err.message}`)
            return false
        }
    }
}

const afkDb = new AfkDatabase()
export default afkDb
