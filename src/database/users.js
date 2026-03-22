import config from '../../config.js'
import logger from '../utils/logger.js'
import { getCollection } from './mongo.js'

class UserDatabase {
    constructor() {
        this._data = {}
        this._col = null
        this._initialized = false
    }

    async init() {
        if (this._initialized) return

        this._col = await getCollection('users')
        await this._col.createIndex({ jid: 1 }, { unique: true })

        const docs = await this._col.find({}, { projection: { _id: 0 } }).toArray()
        this._data = Object.fromEntries(docs.map((d) => [d.jid, d]))

        let changed = 0
        for (const user of Object.values(this._data)) {
            const nextJoin = this._toWibDateTime(user.joinDate)
            const nextSeen = this._toWibDateTime(user.lastSeen)
            if (nextJoin !== user.joinDate || nextSeen !== user.lastSeen) {
                user.joinDate = nextJoin
                user.lastSeen = nextSeen
                changed += 1
                this._persistUser(user.jid)
            }
        }

        this._initialized = true
        logger.ready(`Loaded ${docs.length} users from MongoDB${changed ? ` (normalized ${changed})` : ''}`)
    }

    _toWibDateTime(input = new Date()) {
        const d = input instanceof Date ? input : new Date(input)
        if (Number.isNaN(d.getTime())) {
            return new Date().toLocaleString('id-ID', {
                dateStyle: 'medium',
                timeStyle: 'medium',
                hour12: false,
                timeZone: 'Asia/Jakarta'
            })
        }
        return d.toLocaleString('id-ID', {
            dateStyle: 'medium',
            timeStyle: 'medium',
            hour12: false,
            timeZone: 'Asia/Jakarta'
        })
    }

    _persistUser(jid) {
        if (!this._col) return
        const doc = this._data[jid]
        if (!doc) return
        this._col.updateOne({ jid }, { $set: { ...doc } }, { upsert: true })
            .catch((err) => logger.warn(`Failed save ${jid}: ${err.message}`))
    }

    _deleteUserPersist(jid) {
        if (!this._col) return
        this._col.deleteOne({ jid })
            .catch((err) => logger.warn(`Failed delete ${jid}: ${err.message}`))
    }

    getUser(jid, name = '') {
        if (!this._data[jid]) {
            this._data[jid] = {
                jid,
                name: name || jid.split('@')[0],
                joinDate: this._toWibDateTime(),
                lastSeen: this._toWibDateTime(),
                messageCount: 0,
                banned: false,
                bannedExpiry: false,
                premium: false,
                owner: false,
                limit: config.limits.free,
                limitMax: config.limits.free,
                limitDate: ''
            }
            this._persistUser(jid)
        }
        return this._data[jid]
    }

    updateUser(jid, data) {
        const user = this.getUser(jid)
        Object.assign(user, data)
        this._persistUser(jid)
        return user
    }

    recordMessage(jid, name = '') {
        const user = this.getUser(jid, name)
        user.messageCount += 1
        user.lastSeen = this._toWibDateTime()
        if (name && name !== user.name) user.name = name
        this._persistUser(jid)
        return user
    }

    ban(jid, expiryDate) {
        return this.updateUser(jid, {
            banned: true,
            bannedExpiry: expiryDate instanceof Date ? expiryDate.toISOString() : expiryDate
        })
    }

    unban(jid) { return this.updateUser(jid, { banned: false, bannedExpiry: false }) }

    setPremium(jid, expiryDate) {
        return this.updateUser(jid, {
            premium: expiryDate instanceof Date ? expiryDate.toISOString() : expiryDate
        })
    }

    removePremium(jid) { return this.updateUser(jid, { premium: false }) }

    getPremiumExpiry(jid) {
        const val = this._data[jid]?.premium
        if (!val || val === false) return null
        const d = new Date(val)
        return Number.isNaN(d.getTime()) ? null : d
    }

    addOwner(jid) { return this.updateUser(jid, { owner: true }) }
    removeOwner(jid) { return this.updateUser(jid, { owner: false }) }

    getBanExpiry(jid) {
        const val = this._data[jid]?.bannedExpiry
        if (!val || val === false) return null
        const d = new Date(val)
        return Number.isNaN(d.getTime()) ? null : d
    }

    isBanned(jid) {
        const user = this._data[jid]
        if (!user || user.banned !== true) return false
        const expiry = this.getBanExpiry(jid)
        if (!expiry) return true
        if (expiry <= new Date()) {
            this.unban(jid)
            return false
        }
        return true
    }

    isPremium(jid) {
        const val = this._data[jid]?.premium
        if (!val || val === false) return false
        return new Date(val) > new Date()
    }

    isOwner(jid) { return this._data[jid]?.owner === true }

    deleteUser(jid) {
        if (!this._data[jid]) return false
        delete this._data[jid]
        this._deleteUserPersist(jid)
        return true
    }

    all() { return Object.values(this._data) }
    count() { return Object.keys(this._data).length }
    getBanned() { return this.all().filter((u) => this.isBanned(u.jid)) }
    getPremium() { return this.all().filter((u) => this.isPremium(u.jid)) }
    getOwners() { return this.all().filter((u) => u.owner) }

    _getWibDate() {
        return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
    }

    getMaxLimit(isOwner, isPremium) {
        if (isOwner) return config.limits.owner
        if (isPremium) return config.limits.premium
        return config.limits.free
    }

    getDisplayMaxLimit(jid, isOwner = this.isOwner(jid), isPremium = this.isPremium(jid)) {
        const user = this.getUser(jid)
        const today = this._getWibDate()
        const tierMax = this.getMaxLimit(isOwner, isPremium)
        if (user.limitDate !== today) return tierMax
        if (typeof user.limitMax === 'number') return Math.max(0, user.limitMax)
        return Math.max(0, user.limit ?? tierMax)
    }

    setLimitState(jid, limit, limitMax = limit, { markToday = true } = {}) {
        const user = this.getUser(jid)
        user.limit = Math.max(0, Number(limit) || 0)
        user.limitMax = Math.max(0, Number(limitMax) || 0)
        if (user.limit > user.limitMax) user.limit = user.limitMax
        if (markToday) user.limitDate = this._getWibDate()
        this._persistUser(jid)
        return user
    }

    addLimit(jid, amount) {
        const isOwner = this.isOwner(jid)
        const isPremium = this.isPremium(jid)
        this.checkAndResetLimit(jid, isOwner, isPremium)
        const user = this.getUser(jid)
        const delta = Math.max(0, Number(amount) || 0)
        const currentMax = this.getDisplayMaxLimit(jid, isOwner, isPremium)
        return this.setLimitState(jid, (user.limit ?? 0) + delta, currentMax + delta)
    }

    reduceLimit(jid, amount) {
        const isOwner = this.isOwner(jid)
        const isPremium = this.isPremium(jid)
        this.checkAndResetLimit(jid, isOwner, isPremium)
        const user = this.getUser(jid)
        const delta = Math.max(0, Number(amount) || 0)
        const currentMax = this.getDisplayMaxLimit(jid, isOwner, isPremium)
        return this.setLimitState(
            jid,
            Math.max(0, (user.limit ?? 0) - delta),
            Math.max(0, currentMax - delta)
        )
    }

    resetLimitToTier(jid) {
        const isOwner = this.isOwner(jid)
        const isPremium = this.isPremium(jid)
        const tierMax = this.getMaxLimit(isOwner, isPremium)
        return this.setLimitState(jid, tierMax, tierMax)
    }

    checkAndResetLimit(jid, isOwner, isPremium) {
        const user = this.getUser(jid)
        const today = this._getWibDate()
        const maxLimit = this.getMaxLimit(isOwner, isPremium)
        let changed = false

        if (user.limit === undefined) {
            user.limit = maxLimit
            changed = true
        }

        if (user.limitMax === undefined) {
            user.limitMax = user.limitDate === today
                ? Math.max(0, Number(user.limit) || maxLimit)
                : maxLimit
            changed = true
        }

        if (user.limitDate !== today) {
            user.limit = maxLimit
            user.limitMax = maxLimit
            user.limitDate = today
            changed = true
        }

        if (changed) {
            this._persistUser(jid)
        }
    }

    getLimit(jid) { return this._data[jid]?.limit ?? config.limits.free }
    hasLimit(jid) { return (this._data[jid]?.limit ?? 0) > 0 }

    decrementLimit(jid) {
        const user = this.getUser(jid)
        if (user.limit > 0) {
            user.limit -= 1
            this._persistUser(jid)
        }
    }
}

const db = new UserDatabase()
export default db
