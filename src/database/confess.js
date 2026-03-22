import logger from '../utils/logger.js'
import { getCollection } from './mongo.js'

const randomId = () => `cfs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
const now = () => new Date()

class ConfessDatabase {
    constructor() {
        this._col = null
        this._initialized = false
    }

    async init() {
        if (this._initialized) return
        this._col = await getCollection('confess')
        await Promise.all([
            this._col.createIndex({ a: 1 }, { unique: false }),
            this._col.createIndex({ b: 1 }, { unique: false }),
            this._col.createIndex({ status: 1 }, { unique: false }),
            this._col.createIndex({ id: 1 }, { unique: true })
        ])
        this._initialized = true
        logger.ready('Confess ready')
    }

    async _ensure() {
        if (!this._initialized) await this.init()
    }

    async createSession({ a, b }) {
        await this._ensure()

        const session = {
            id: randomId(),
            a,
            b,
            status: 'pending',
            createdAt: now(),
            updatedAt: now()
        }

        const inserted = await this._col.insertOne(session)
        if (!inserted.insertedId) throw new Error('gagal membuat sesi confess')
        return session
    }

    async getSessionByUser(jid) {
        await this._ensure()
        return this._col.findOne({ $or: [{ a: jid }, { b: jid }] })
    }

    async getSessionById(sessionId) {
        await this._ensure()
        return this._col.findOne({ id: sessionId })
    }

    async getSessionByUsers(a, b) {
        await this._ensure()
        return this._col.findOne({
            $or: [
                { a, b },
                { a: b, b: a }
            ]
        })
    }

    async updateSession(sessionId, updates = {}) {
        await this._ensure()
        if (!sessionId) throw new Error('sessionId diperlukan')
        const payload = { ...updates, updatedAt: now() }
        const result = await this._col.updateOne({ id: sessionId }, { $set: payload })
        return result
    }

    async setStatus(sessionId, status) {
        return this.updateSession(sessionId, { status })
    }

    async removeSession(sessionId) {
        await this._ensure()
        return this._col.deleteOne({ id: sessionId })
    }
}

const confessDb = new ConfessDatabase()
export default confessDb
