import logger from '../utils/logger.js'
import { getRedis } from './redis.js'

const clean = (value) => String(value || '').trim()
const normalizeStatus = (value) => clean(value).toLowerCase() || 'pending'
const toNum = (value, fallback = 0) => {
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
}

const REDIS_NS = 'ghs:verify'
const ACTIVE_KEY = `${REDIS_NS}:active`
const JOB_TTL_SEC = 60 * 60 * 24 * 7
const REDIS_CONNECT_TIMEOUT_MS = 4000
const makeJobKey = (jobId) => `${REDIS_NS}:job:${clean(jobId)}`

const withTimeout = async (promise, timeoutMs = REDIS_CONNECT_TIMEOUT_MS) => {
    let timer = null
    try {
        return await Promise.race([
            promise,
            new Promise((resolve) => {
                timer = setTimeout(() => resolve(null), timeoutMs)
            })
        ])
    } finally {
        if (timer) clearTimeout(timer)
    }
}

const toDoc = (raw = {}) => ({
    jobId: clean(raw.jobId),
    chatJid: clean(raw.chatJid),
    requesterJid: clean(raw.requesterJid),
    requesterName: clean(raw.requesterName),
    email: clean(raw.email),
    role: clean(raw.role) || 'student',
    status: normalizeStatus(raw.status),
    active: raw.active === true,
    verifyResponse: raw.verifyResponse || null,
    lastResponse: raw.lastResponse || null,
    errorMessage: clean(raw.errorMessage),
    createdAt: toNum(raw.createdAt, Date.now()),
    updatedAt: toNum(raw.updatedAt, Date.now()),
    lastCheckedAt: raw.lastCheckedAt == null ? null : toNum(raw.lastCheckedAt, 0),
    lastNotifiedStatus: normalizeStatus(raw.lastNotifiedStatus || ''),
    lastNotifiedAt: raw.lastNotifiedAt == null ? null : toNum(raw.lastNotifiedAt, 0),
    loginSuccessNotified: raw.loginSuccessNotified === true,
    pollErrorCount: Math.max(0, toNum(raw.pollErrorCount, 0)),
    chargedUserJid: clean(raw.chargedUserJid),
    coinCost: Math.max(0, toNum(raw.coinCost, 0)),
    coinsReserved: raw.coinsReserved === true,
    coinsSettled: raw.coinsSettled === true,
    coinSettledAt: raw.coinSettledAt == null ? null : toNum(raw.coinSettledAt, 0),
    coinSettlementStatus: clean(raw.coinSettlementStatus)
})

const parseDoc = (raw = '') => {
    if (!raw) return null
    try {
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
        const doc = toDoc(parsed)
        if (!doc.jobId) return null
        return doc
    } catch {
        return null
    }
}

class GhsVerifyJobsDb {
    constructor() {
        this._initialized = false
        this._useRedis = false
        this._warnedFallback = false
        this._memory = new Map()
    }

    async init() {
        if (this._initialized) return
        const redis = await withTimeout(getRedis().catch(() => null))
        this._useRedis = Boolean(redis)
        this._initialized = true
        logger.ready(`GHS verify jobs DB ready (${this._useRedis ? 'Redis' : 'memory fallback'})`)
    }

    async _ensure() {
        if (!this._initialized) await this.init()
    }

    async _getRedis() {
        await this._ensure()
        if (!this._useRedis) return null
        const redis = await withTimeout(getRedis().catch(() => null))
        if (!redis) {
            this._useRedis = false
            if (!this._warnedFallback) {
                this._warnedFallback = true
                logger.warn('[GHS] Redis tidak tersedia, fallback ke memory')
            }
            return null
        }
        return redis
    }

    async _save(doc) {
        const normalized = toDoc(doc)
        if (!normalized.jobId) return null

        const redis = await this._getRedis()
        if (!redis) {
            this._memory.set(normalized.jobId, normalized)
            return normalized
        }

        const score = normalized.updatedAt || Date.now()
        const key = makeJobKey(normalized.jobId)
        const payload = JSON.stringify(normalized)

        try {
            const multi = redis.multi()
            multi.set(key, payload, { EX: JOB_TTL_SEC })
            if (normalized.active === true) {
                multi.zAdd(ACTIVE_KEY, [{ score, value: normalized.jobId }])
            } else {
                multi.zRem(ACTIVE_KEY, normalized.jobId)
            }
            await multi.exec()
            return normalized
        } catch {
            this._memory.set(normalized.jobId, normalized)
            return normalized
        }
    }

    async _load(jobId) {
        const id = clean(jobId)
        if (!id) return null

        const redis = await this._getRedis()
        if (!redis) {
            return this._memory.get(id) || null
        }

        try {
            const raw = await redis.get(makeJobKey(id))
            const doc = parseDoc(raw)
            if (!doc) {
                await redis.zRem(ACTIVE_KEY, id).catch(() => {})
            }
            return doc
        } catch {
            return this._memory.get(id) || null
        }
    }

    async upsertFromVerify({
        jobId,
        chatJid,
        requesterJid,
        requesterName = '',
        email,
        role = 'student',
        status = 'pending',
        verifyResponse = null,
        active = true
    }) {
        await this._ensure()
        const id = clean(jobId)
        const now = Date.now()
        const existing = await this._load(id)

        const doc = {
            ...(existing || {}),
            jobId: id,
            chatJid: clean(chatJid),
            requesterJid: clean(requesterJid),
            requesterName: clean(requesterName),
            email: clean(email),
            role: clean(role) || 'student',
            status: normalizeStatus(status),
            active: active === true,
            verifyResponse,
            lastResponse: verifyResponse,
            errorMessage: '',
            createdAt: toNum(existing?.createdAt, now),
            updatedAt: now,
            lastCheckedAt: existing?.lastCheckedAt ?? null,
            lastNotifiedStatus: normalizeStatus(existing?.lastNotifiedStatus || 'logging_in'),
            lastNotifiedAt: existing?.lastNotifiedAt ?? now,
            loginSuccessNotified: existing?.loginSuccessNotified === true,
            pollErrorCount: 0
        }

        return this._save(doc)
    }

    async getJob(jobId) {
        await this._ensure()
        return this._load(jobId)
    }

    async getActiveJobs(limit = 200) {
        await this._ensure()
        const max = Math.max(1, Math.min(1000, Number(limit) || 200))
        const redis = await this._getRedis()

        if (!redis) {
            return [...this._memory.values()]
                .filter((x) => x.active === true)
                .sort((a, b) => toNum(a.updatedAt) - toNum(b.updatedAt))
                .slice(0, max)
        }

        let ids = []
        try {
            ids = await redis.zRange(ACTIVE_KEY, 0, max - 1)
        } catch {
            return []
        }

        const jobs = []
        for (const id of ids) {
            const doc = await this._load(id)
            if (!doc || doc.active !== true) {
                await redis.zRem(ACTIVE_KEY, id).catch(() => {})
                continue
            }
            jobs.push(doc)
        }

        jobs.sort((a, b) => toNum(a.updatedAt) - toNum(b.updatedAt))
        return jobs.slice(0, max)
    }

    async deactivateActiveByChatEmail(chatJid, email) {
        await this._ensure()
        const targetChat = clean(chatJid)
        const targetEmail = clean(email).toLowerCase()
        if (!targetChat || !targetEmail) return 0

        const jobs = await this.getActiveJobs(500)
        let changed = 0

        for (const job of jobs) {
            const sameChat = clean(job.chatJid) === targetChat
            const sameEmail = clean(job.email).toLowerCase() === targetEmail
            if (!sameChat || !sameEmail) continue
            if (job.active !== true) continue

            await this._save({
                ...job,
                active: false,
                updatedAt: Date.now()
            })
            changed += 1
        }

        return changed
    }

    async updateFromJobCheck(jobId, {
        status,
        active,
        lastResponse = null,
        errorMessage = '',
        pollErrorCount = null
    }) {
        await this._ensure()
        const existing = await this._load(jobId)
        if (!existing) return null

        const now = Date.now()
        const doc = {
            ...existing,
            status: normalizeStatus(status),
            active: active === true,
            lastResponse,
            errorMessage: clean(errorMessage),
            updatedAt: now,
            lastCheckedAt: now,
            pollErrorCount: pollErrorCount == null
                ? Math.max(0, toNum(existing.pollErrorCount, 0))
                : Math.max(0, toNum(pollErrorCount, 0))
        }

        return this._save(doc)
    }

    async markNotified(jobId, status) {
        await this._ensure()
        const existing = await this._load(jobId)
        if (!existing) return
        await this._save({
            ...existing,
            lastNotifiedStatus: normalizeStatus(status),
            lastNotifiedAt: Date.now(),
            updatedAt: Date.now()
        })
    }

    async markLoginSuccessNotified(jobId) {
        await this._ensure()
        const existing = await this._load(jobId)
        if (!existing) return
        await this._save({
            ...existing,
            loginSuccessNotified: true,
            updatedAt: Date.now()
        })
    }

    async setCoinReservation(jobId, { chargedUserJid = '', coinCost = 0, coinsReserved = false } = {}) {
        await this._ensure()
        const existing = await this._load(jobId)
        if (!existing) return null

        const updated = {
            ...existing,
            chargedUserJid: clean(chargedUserJid),
            coinCost: Math.max(0, toNum(coinCost, 0)),
            coinsReserved: coinsReserved === true,
            coinsSettled: false,
            coinSettledAt: null,
            coinSettlementStatus: '',
            updatedAt: Date.now()
        }

        return this._save(updated)
    }

    async markCoinsSettled(jobId, status = '') {
        await this._ensure()
        const existing = await this._load(jobId)
        if (!existing) return null

        const updated = {
            ...existing,
            coinsSettled: true,
            coinSettledAt: Date.now(),
            coinSettlementStatus: clean(status),
            updatedAt: Date.now()
        }

        return this._save(updated)
    }
}

const ghsVerifyJobsDb = new GhsVerifyJobsDb()
export default ghsVerifyJobsDb
