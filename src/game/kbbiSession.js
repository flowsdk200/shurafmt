import logger from '../utils/logger.js'
import { getRedis } from '../database/redis.js'

const sessionsById = new Map()
const sessionIdByChat = new Map()
const sessionIdByUser = new Map()

const REDIS_NS = 'kbbi:session'
const REDIS_IDS_KEY = `${REDIS_NS}:ids`
const REDIS_TTL_SEC = 60 * 60 * 6

const randomId = () => `kbbi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
const dataKey = (id) => `${REDIS_NS}:data:${id}`
const chatKey = (chatId) => `${REDIS_NS}:chat:${chatId}`
const userKey = (jid) => `${REDIS_NS}:user:${jid}`

let restoring = false

const toPlainSession = (session) => ({
    id: session.id,
    chatId: session.chatId,
    mode: session.mode,
    status: session.status,
    creator: session.creator,
    opponent: session.opponent,
    players: Array.isArray(session.players) ? [...session.players] : [],
    createdAt: Number(session.createdAt || 0),
    startedAt: Number(session.startedAt || 0),
    round: Number(session.round || 0),
    totalRounds: Number(session.totalRounds || 1),
    roundWins: session.roundWins || {},
    turn: session.turn || '',
    requiredPrefix: session.requiredPrefix || '',
    prefixLen: Number(session.prefixLen || 1),
    turnTimeoutSec: Number(session.turnTimeoutSec || 25),
    turnStartedAt: Number(session.turnStartedAt || 0),
    turnDeadlineAt: Number(session.turnDeadlineAt || 0),
    lobbyDeadlineAt: Number(session.lobbyDeadlineAt || 0),
    strikes: session.strikes || {},
    combo: session.combo || {},
    wordCounts: session.wordCounts || {},
    usedWords: Array.from(session.usedWords || []),
    totalMoves: Number(session.totalMoves || 0)
})

const fromPlainSession = (raw) => ({
    ...raw,
    players: Array.isArray(raw.players) ? raw.players : [],
    roundWins: raw.roundWins || {},
    strikes: raw.strikes || {},
    combo: raw.combo || {},
    wordCounts: raw.wordCounts || {},
    usedWords: new Set(Array.isArray(raw.usedWords) ? raw.usedWords : []),
    timerRef: null,
    lobbyTimerRef: null,
    locked: false,
    turnDeadlineAt: Number(raw.turnDeadlineAt || 0),
    lobbyDeadlineAt: Number(raw.lobbyDeadlineAt || 0)
})

const isSessionExpired = (session) => {
    if (!session) return true
    const now = Date.now()
    if (session.status === 'lobi' && Number(session.lobbyDeadlineAt || 0) > 0) {
        return Number(session.lobbyDeadlineAt) <= now
    }
    if (session.status === 'bermain' && Number(session.turnDeadlineAt || 0) > 0) {
        return Number(session.turnDeadlineAt) <= now
    }
    return false
}

const removePersistedSession = async (session) => {
    const redis = await getRedis()
    if (!redis || !session?.id) return
    try {
        const multi = redis.multi()
        multi.sRem(REDIS_IDS_KEY, session.id)
        multi.del(dataKey(session.id))
        if (session.chatId) multi.del(chatKey(session.chatId))
        for (const jid of session.players || []) {
            multi.del(userKey(jid))
        }
        await multi.exec()
    } catch {}
}

const persistSession = async (session) => {
    const redis = await getRedis()
    if (!redis || !session?.id) return
    try {
        const payload = JSON.stringify(toPlainSession(session))
        const multi = redis.multi()
        multi.sAdd(REDIS_IDS_KEY, session.id)
        multi.set(dataKey(session.id), payload, { EX: REDIS_TTL_SEC })
        if (session.chatId) multi.set(chatKey(session.chatId), session.id, { EX: REDIS_TTL_SEC })
        for (const jid of session.players || []) {
            multi.set(userKey(jid), session.id, { EX: REDIS_TTL_SEC })
        }
        await multi.exec()
    } catch {}
}

const getSessionRef = (sessionOrId) => {
    if (!sessionOrId) return null
    if (typeof sessionOrId === 'string') return sessionsById.get(sessionOrId) || null
    if (sessionOrId.id) return sessionsById.get(sessionOrId.id) || sessionOrId
    return null
}

const clearTimerRef = (timerRef) => {
    if (!timerRef) return
    try {
        clearTimeout(timerRef)
    } catch {}
}

const registerSession = (session) => {
    sessionsById.set(session.id, session)
    sessionIdByChat.set(session.chatId, session.id)
    session.players.forEach((jid) => sessionIdByUser.set(jid, session.id))
    if (!restoring) void persistSession(session)
}

const unregisterSession = (session) => {
    sessionsById.delete(session.id)
    sessionIdByChat.delete(session.chatId)
    session.players.forEach((jid) => {
        if (sessionIdByUser.get(jid) === session.id) {
            sessionIdByUser.delete(jid)
        }
    })
    if (!restoring) void removePersistedSession(session)
}

const purgeIfExpired = (session) => {
    if (!session) return null
    if (!isSessionExpired(session)) return session
    clearTimerRef(session.timerRef)
    clearTimerRef(session.lobbyTimerRef)
    unregisterSession(session)
    return null
}

const restoreSessionsFromRedis = async () => {
    const redis = await getRedis()
    if (!redis) return
    try {
        const ids = await redis.sMembers(REDIS_IDS_KEY)
        if (!Array.isArray(ids) || !ids.length) return

        restoring = true
        let restored = 0
        for (const id of ids) {
            const payload = await redis.get(dataKey(id))
            if (!payload) {
                await redis.sRem(REDIS_IDS_KEY, id)
                continue
            }
            let parsed = null
            try {
                parsed = JSON.parse(payload)
            } catch {
                await redis.sRem(REDIS_IDS_KEY, id)
                await redis.del(dataKey(id))
                continue
            }
            const session = fromPlainSession(parsed || {})
            if (!session.id || !session.chatId || !Array.isArray(session.players) || session.players.length < 2) {
                await redis.sRem(REDIS_IDS_KEY, id)
                await redis.del(dataKey(id))
                continue
            }
            if (isSessionExpired(session)) {
                await removePersistedSession(session)
                continue
            }
            registerSession(session)
            restored += 1
        }
        if (restored > 0) {
            logger.info(`KBBI sesi dipulihkan dari Redis: ${restored}`)
        }
    } catch (err) {
        logger.warn(`Gagal pulihkan sesi KBBI dari Redis: ${err.message}`)
    } finally {
        restoring = false
    }
}

await restoreSessionsFromRedis()

export const kbbiSession = {
    createLobby({ chatId, creator, opponent, mode = 'klasik', totalRounds = 1 }) {
        if (!chatId || !creator || !opponent) throw new Error('Data sesi tidak lengkap')
        if (sessionIdByChat.has(chatId)) throw new Error('Masih ada sesi aktif di grup ini')
        if (sessionIdByUser.has(creator) || sessionIdByUser.has(opponent)) {
            throw new Error('Salah satu pemain masih terdaftar di sesi lain')
        }

        const session = {
            id: randomId(),
            chatId,
            mode,
            status: 'lobi',
            creator,
            opponent,
            players: [creator, opponent],
            createdAt: Date.now(),
            startedAt: 0,
            round: 0,
            totalRounds: Math.max(1, Number(totalRounds) || 1),
            roundWins: { [creator]: 0, [opponent]: 0 },
            turn: '',
            requiredPrefix: '',
            prefixLen: 1,
            turnTimeoutSec: 25,
            turnStartedAt: 0,
            turnDeadlineAt: 0,
            lobbyDeadlineAt: 0,
            strikes: { [creator]: 0, [opponent]: 0 },
            combo: { [creator]: 0, [opponent]: 0 },
            wordCounts: { [creator]: 0, [opponent]: 0 },
            usedWords: new Set(),
            totalMoves: 0,
            timerRef: null,
            lobbyTimerRef: null,
            locked: false
        }

        registerSession(session)
        return session
    },

    getById(sessionId) {
        return purgeIfExpired(sessionsById.get(sessionId) || null)
    },

    getByChat(chatId) {
        const id = sessionIdByChat.get(chatId)
        return id ? purgeIfExpired(sessionsById.get(id) || null) : null
    },

    getByUser(jid) {
        const id = sessionIdByUser.get(jid)
        return id ? purgeIfExpired(sessionsById.get(id) || null) : null
    },

    setTurnTimer(sessionOrId, ms, cb) {
        const session = getSessionRef(sessionOrId)
        if (!session) return
        clearTimerRef(session.timerRef)
        const delay = Math.max(1000, Number(ms) || 1000)
        session.turnDeadlineAt = Date.now() + delay
        session.timerRef = setTimeout(() => cb(session.id), delay)
        void persistSession(session)
    },

    clearTurnTimer(sessionOrId) {
        const session = getSessionRef(sessionOrId)
        if (!session) return
        clearTimerRef(session.timerRef)
        session.timerRef = null
        session.turnDeadlineAt = 0
        void persistSession(session)
    },

    setLobbyTimer(sessionOrId, ms, cb) {
        const session = getSessionRef(sessionOrId)
        if (!session) return
        clearTimerRef(session.lobbyTimerRef)
        const delay = Math.max(1000, Number(ms) || 1000)
        session.lobbyDeadlineAt = Date.now() + delay
        session.lobbyTimerRef = setTimeout(() => cb(session.id), delay)
        void persistSession(session)
    },

    clearLobbyTimer(sessionOrId) {
        const session = getSessionRef(sessionOrId)
        if (!session) return
        clearTimerRef(session.lobbyTimerRef)
        session.lobbyTimerRef = null
        session.lobbyDeadlineAt = 0
        void persistSession(session)
    },

    save(sessionOrId) {
        const session = getSessionRef(sessionOrId)
        if (!session) return
        void persistSession(session)
    },

    remove(sessionOrId) {
        const session = getSessionRef(sessionOrId)
        if (!session) return
        clearTimerRef(session.timerRef)
        clearTimerRef(session.lobbyTimerRef)
        unregisterSession(session)
    }
}

export default kbbiSession

