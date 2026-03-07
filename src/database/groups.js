import logger from '../utils/logger.js'
import { normalizeJid } from '../utils/jid.js'
import { getCollection } from './mongo.js'
import config from '../../config.js'

class GroupDatabase {
    constructor() {
        this._data = {}
        this._col = null
        this._initialized = false
    }

    async init() {
        if (this._initialized) return

        this._col = await getCollection('groups')
        await this._col.createIndex({ jid: 1 }, { unique: true })

        const docs = await this._col.find({}, { projection: { _id: 0 } }).toArray()
        this._data = Object.fromEntries(docs.map((d) => [d.jid, d]))

        let changed = 0
        for (const group of Object.values(this._data)) {
            const nextJoin = this._toWibDateTime(group.joinDate)
            const nextSeen = this._toWibDateTime(group.lastSeen)
            if (nextJoin !== group.joinDate || nextSeen !== group.lastSeen) {
                group.joinDate = nextJoin
                group.lastSeen = nextSeen
                changed += 1
                this._persistGroup(group.jid)
            }
        }

        this._initialized = true
        logger.ready(`Loaded ${docs.length} groups from MongoDB${changed ? ` (normalized ${changed})` : ''}`)
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

    _toWarnDateTime(input = new Date()) {
        const d = input instanceof Date ? input : new Date(input)
        const date = Number.isNaN(d.getTime()) ? new Date() : d
        const day = String(date.getDate()).padStart(2, '0')
        const month = date.toLocaleString('id-ID', { month: 'short', timeZone: 'Asia/Jakarta' })
        const year = date.toLocaleString('id-ID', { year: 'numeric', timeZone: 'Asia/Jakarta' })
        const time = date.toLocaleString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: 'Asia/Jakarta'
        }).replace(':', '.')
        return `${day} ${month} ${year}, ${time}`
    }

    _persistGroup(jid) {
        if (!this._col) return
        const doc = this._data[jid]
        if (!doc) return
        this._col.updateOne({ jid }, { $set: { ...doc } }, { upsert: true })
            .catch((err) => logger.warn(`Failed save ${jid}: ${err.message}`))
    }

    _deleteGroupPersist(jid) {
        if (!this._col) return
        this._col.deleteOne({ jid })
            .catch((err) => logger.warn(`Failed delete ${jid}: ${err.message}`))
    }

    getGroup(jid, name = '') {
        if (!this._data[jid]) {
            this._data[jid] = {
                jid,
                name: name || jid,
                joinDate: this._toWibDateTime(),
                lastSeen: this._toWibDateTime(),
                messageCount: 0,
                membersCount: 0,
                adminsCount: 0,
                admins: [],
                owner: null,
                description: '',
                creation: null,
                inviteCode: '',
                settings: {
                    welcome: config.groupDefaults?.welcome ?? true,
                    goodbye: config.groupDefaults?.goodbye ?? true,
                },
                enabled: true,
                muted: false
            }
            this._persistGroup(jid)
        }
        return this._data[jid]
    }

    updateGroup(jid, data = {}) {
        const group = this.getGroup(jid)
        Object.assign(group, data)
        this._persistGroup(jid)
        return group
    }

    setSetting(jid, key, value) {
        const group = this.getGroup(jid)
        if (!group.settings || typeof group.settings !== 'object') group.settings = {}
        group.settings[key] = value
        this._persistGroup(jid)
        return group
    }

    getSetting(jid, key, defaultValue = undefined) {
        const group = this.getGroup(jid)
        if (!group.settings || typeof group.settings !== 'object') return defaultValue
        return group.settings[key] ?? defaultValue
    }

    _ensureWarnUsers(group) {
        if (!group.settings || typeof group.settings !== 'object') group.settings = {}
        if (!group.settings.warnUsers || typeof group.settings.warnUsers !== 'object') {
            group.settings.warnUsers = {}
        }
        return group.settings.warnUsers
    }

    _ensureStoreOrders(group) {
        if (!group.settings || typeof group.settings !== 'object') group.settings = {}
        if (!group.settings.storeOrders || typeof group.settings.storeOrders !== 'object') {
            group.settings.storeOrders = {}
        }
        return group.settings.storeOrders
    }

    addWarn(jid, userJid) {
        const group = this.getGroup(jid)
        const warnUsers = this._ensureWarnUsers(group)
        const normalized = normalizeJid(userJid) || userJid
        const current = warnUsers[normalized] && typeof warnUsers[normalized] === 'object'
            ? warnUsers[normalized]
            : { count: 0, updatedAt: '' }

        current.count = Math.min(3, Number(current.count || 0) + 1)
        current.updatedAt = this._toWarnDateTime()

        warnUsers[normalized] = current
        this._persistGroup(jid)
        return { jid: normalized, ...current }
    }

    getWarn(jid, userJid) {
        const group = this.getGroup(jid)
        const warnUsers = this._ensureWarnUsers(group)
        const normalized = normalizeJid(userJid) || userJid
        const current = warnUsers[normalized]
        if (!current || typeof current !== 'object') {
            return { jid: normalized, count: 0, updatedAt: '' }
        }
        return {
            jid: normalized,
            count: Number(current.count || 0),
            updatedAt: current.updatedAt || ''
        }
    }

    clearWarn(jid, userJid) {
        const group = this.getGroup(jid)
        const warnUsers = this._ensureWarnUsers(group)
        const normalized = normalizeJid(userJid) || userJid
        const current = warnUsers[normalized]
        if (!current) return false
        delete warnUsers[normalized]
        this._persistGroup(jid)
        return true
    }

    listWarns(jid) {
        const group = this.getGroup(jid)
        const warnUsers = this._ensureWarnUsers(group)
        return Object.entries(warnUsers)
            .map(([userJid, data]) => ({
                jid: userJid,
                count: Number(data?.count || 0),
                updatedAt: data?.updatedAt || ''
            }))
            .filter((item) => item.count > 0)
            .sort((a, b) => b.count - a.count || a.jid.localeCompare(b.jid))
    }

    setStoreOrder(jid, userJid, product) {
        const group = this.getGroup(jid)
        const storeOrders = this._ensureStoreOrders(group)
        const normalized = normalizeJid(userJid) || userJid
        storeOrders[normalized] = {
            product: String(product || '').trim(),
            createdAt: new Date().toISOString()
        }
        this._persistGroup(jid)
        return { jid: normalized, ...storeOrders[normalized] }
    }

    getStoreOrder(jid, userJid) {
        const group = this.getGroup(jid)
        const storeOrders = this._ensureStoreOrders(group)
        const normalized = normalizeJid(userJid) || userJid
        const order = storeOrders[normalized]
        if (!order || typeof order !== 'object') return null
        return { jid: normalized, ...order }
    }

    clearStoreOrder(jid, userJid) {
        const group = this.getGroup(jid)
        const storeOrders = this._ensureStoreOrders(group)
        const normalized = normalizeJid(userJid) || userJid
        const current = storeOrders[normalized]
        if (!current) return false
        delete storeOrders[normalized]
        this._persistGroup(jid)
        return true
    }

    muteUser(jid, userJid, durationMs = 24 * 60 * 60 * 1000) {
        const group = this.getGroup(jid)
        if (!group.settings || typeof group.settings !== 'object') group.settings = {}
        if (!group.settings.mutedUsers || typeof group.settings.mutedUsers !== 'object') {
            group.settings.mutedUsers = {}
        }
        group.settings.mutedUsers[userJid] = Date.now() + durationMs
        this._persistGroup(jid)
        return group.settings.mutedUsers[userJid]
    }

    unmuteUser(jid, userJid) {
        const group = this.getGroup(jid)
        if (group.settings?.mutedUsers?.[userJid]) {
            delete group.settings.mutedUsers[userJid]
            this._persistGroup(jid)
        }
    }

    getUserMuteExpiry(jid, userJid) {
        const group = this.getGroup(jid)
        const v = group.settings?.mutedUsers?.[userJid]
        return typeof v === 'number' ? v : 0
    }

    isUserMuted(jid, userJid) {
        const expiry = this.getUserMuteExpiry(jid, userJid)
        if (!expiry) return false
        if (Date.now() >= expiry) {
            this.unmuteUser(jid, userJid)
            return false
        }
        return true
    }

    recordMessage(jid, name = '', metadata = null) {
        const group = this.getGroup(jid, name)
        group.messageCount += 1
        group.lastSeen = this._toWibDateTime()

        if (name && name !== group.name) group.name = name

        if (metadata) {
            if (metadata.subject) group.name = metadata.subject
            if (Array.isArray(metadata.participants)) {
                group.membersCount = metadata.participants.length
                group.adminsCount = metadata.participants.filter((p) => p.admin).length
                group.admins = metadata.participants
                    .filter((p) => p.admin)
                    .map((p) => {
                        const normalized = normalizeJid(p.id)
                        if (normalized && !normalized.endsWith('@lid')) return normalized
                        if (p.phoneNumber) return normalizeJid(p.phoneNumber) || p.phoneNumber
                        return normalized
                    })
                    .filter(Boolean)
            }

            if (metadata.owner) {
                const ownerNorm = normalizeJid(metadata.owner)
                group.owner = ownerNorm || metadata.owner
            }
            if (metadata.desc !== undefined) group.description = metadata.desc || ''
            if (metadata.creation) group.creation = metadata.creation
            if (metadata.inviteCode) group.inviteCode = metadata.inviteCode

            const keys = ['announce', 'restrict', 'memberAddMode', 'joinApprovalMode', 'ephemeralDuration']
            for (const k of keys) {
                if (metadata[k] !== undefined) group.settings[k] = metadata[k]
            }
        }

        this._persistGroup(jid)
        return group
    }

    getAdmins(jid) { return this._data[jid]?.admins || [] }

    isAdmin(jid, userJid) {
        const admins = this.getAdmins(jid)
        const normalized = normalizeJid(userJid) || userJid
        return admins.includes(normalized) || admins.includes(userJid)
    }

    getOwner(jid) { return this._data[jid]?.owner || null }
    setMuted(jid, muted = true) { return this.updateGroup(jid, { muted: !!muted }) }
    setEnabled(jid, enabled = true) { return this.updateGroup(jid, { enabled: !!enabled }) }

    deleteGroup(jid) {
        if (!this._data[jid]) return false
        delete this._data[jid]
        this._deleteGroupPersist(jid)
        return true
    }

    all() { return Object.values(this._data) }
    count() { return Object.keys(this._data).length }
}

const groupsDb = new GroupDatabase()
export default groupsDb
