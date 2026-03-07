import { getCollection } from './mongo.js'
import logger from '../utils/logger.js'

class ResponseDatabase {
    constructor() {
        this._col = null
        this._initialized = false
    }

    async init() {
        if (this._initialized) return
        this._col = await getCollection('responses')
        await this._col.createIndex({ key: 1 }, { unique: true })
        this._initialized = true
    }

    async setResponse(key, data) {
        await this.init()
        const normalized = String(key || '').trim().toLowerCase()
        const doc = {
            key: normalized,
            ...data,
            updatedAt: new Date().toISOString()
        }
        await this._col.updateOne({ key: normalized }, { $set: doc }, { upsert: true })
        return doc
    }

    async getResponse(key) {
        await this.init()
        const normalized = String(key || '').trim().toLowerCase()
        return this._col.findOne({ key: normalized }, { projection: { _id: 0 } })
            .catch((err) => {
                logger.warn(`responses.getResponse ${normalized}: ${err.message}`)
                return null
            })
    }

    async deleteResponse(key) {
        await this.init()
        const normalized = String(key || '').trim().toLowerCase()
        const current = await this.getResponse(normalized)
        if (!current) return null
        await this._col.deleteOne({ key: normalized })
        return current
    }

    async listResponses() {
        await this.init()
        return this._col.find({}, { projection: { _id: 0 } }).sort({ key: 1 }).toArray()
    }
}

const responsesDb = new ResponseDatabase()
export default responsesDb
