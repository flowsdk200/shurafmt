import logger from '../utils/logger.js'
import config from '../../config.js'
import { getCollection } from './mongo.js'

class SettingsDatabase {
    constructor() {
        this._col = null
        this._initialized = false
        this._key = 'bot'
        this._data = {
            key: this._key,
            onlyGroup: false,
            onlyPrivate: false,
            onlyOwner: false,
            onlyPremium: false,
            autoRead: true
        }
    }

    async init() {
        if (this._initialized) return

        this._col = await getCollection('settings')
        await this._col.createIndex({ key: 1 }, { unique: true })

        const doc = await this._col.findOne(
            { key: this._key },
            { projection: { _id: 0 } }
        )

        if (doc) {
            this._data = {
                key: this._key,
                onlyGroup: doc.onlyGroup === true,
                onlyPrivate: doc.onlyPrivate === true,
                onlyOwner: doc.onlyOwner === true,
                onlyPremium: doc.onlyPremium === true,
                autoRead: doc.autoRead !== false
            }
        } else {
            this._data = {
                key: this._key,
                onlyGroup: config.onlyGroup === true,
                onlyPrivate: config.onlyPrivate === true,
                onlyOwner: config.onlyOwner === true,
                onlyPremium: config.onlyPremium === true,
                autoRead: config.autoRead !== false
            }
            await this._persist()
        }

        config.onlyGroup = this._data.onlyGroup
        config.onlyPrivate = this._data.onlyPrivate
        config.onlyOwner = this._data.onlyOwner
        config.onlyPremium = this._data.onlyPremium
        config.autoRead = this._data.autoRead

        this._initialized = true
        logger.ready(`Loaded bot settings from MongoDB (onlyGroup=${config.onlyGroup}, onlyPrivate=${config.onlyPrivate}, onlyOwner=${config.onlyOwner}, onlyPremium=${config.onlyPremium}, autoRead=${config.autoRead})`)
    }

    async _persist() {
        if (!this._col) return
        await this._col.updateOne(
            { key: this._key },
            { $set: { ...this._data } },
            { upsert: true }
        )
    }

    getSettings() {
        return { ...this._data }
    }

    async setRestrictions({ onlyGroup, onlyPrivate, onlyOwner, onlyPremium }) {
        this._data.onlyGroup = onlyGroup === true
        this._data.onlyPrivate = onlyPrivate === true
        this._data.onlyOwner = onlyOwner === true
        this._data.onlyPremium = onlyPremium === true

        const activeModes = ['onlyGroup', 'onlyPrivate', 'onlyOwner', 'onlyPremium']
            .filter((key) => this._data[key] === true)

        if (activeModes.length > 1) {
            const keep = activeModes[0]
            for (const key of ['onlyGroup', 'onlyPrivate', 'onlyOwner', 'onlyPremium']) {
                this._data[key] = key === keep
            }
        }

        config.onlyGroup = this._data.onlyGroup
        config.onlyPrivate = this._data.onlyPrivate
        config.onlyOwner = this._data.onlyOwner
        config.onlyPremium = this._data.onlyPremium

        await this._persist()
        return this.getSettings()
    }

    async setAutoRead(value) {
        this._data.autoRead = value !== false
        config.autoRead = this._data.autoRead
        await this._persist()
        return this.getSettings()
    }
}

const settingsDb = new SettingsDatabase()
export default settingsDb
