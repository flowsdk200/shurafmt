import { getRedis } from '../database/redis.js'

const SESSION_TTL_SEC = 25 * 60
const REDIS_NS = 'wpread:session'
const makeKey = (chatJid) => `${REDIS_NS}:chat:${chatJid}`

const toPayload = (payload = {}) => ({
    storyId: String(payload?.storyId || '').trim(),
    part: Number.parseInt(payload?.part || 1, 10) || 1,
    totalParts: Number.parseInt(payload?.totalParts || 0, 10) || 0,
    updatedAt: Date.now()
})

export const setWpreadSession = async (chatJid, sender, payload = {}) => {
    const redis = await getRedis()
    if (!redis) return

    const key = makeKey(chatJid)
    const data = toPayload(payload)
    if (!data.storyId) {
        await redis.del(key).catch(() => {})
        return
    }

    await redis.set(key, JSON.stringify(data), { EX: SESSION_TTL_SEC }).catch(() => {})
}

export const getWpreadSession = async (chatJid, sender) => {
    const redis = await getRedis()
    if (!redis) return null

    const key = makeKey(chatJid)
    const raw = await redis.get(key).catch(() => null)
    if (!raw) return null

    try {
        const data = JSON.parse(raw)
        if (!data?.storyId) {
            await redis.del(key).catch(() => {})
            return null
        }
        return {
            storyId: String(data.storyId),
            part: Number.parseInt(data.part || 1, 10) || 1,
            totalParts: Number.parseInt(data.totalParts || 0, 10) || 0,
            updatedAt: Number.parseInt(data.updatedAt || 0, 10) || Date.now()
        }
    } catch {
        await redis.del(key).catch(() => {})
        return null
    }
}

export const clearWpreadSession = async (chatJid, sender) => {
    const redis = await getRedis()
    if (!redis) return
    await redis.del(makeKey(chatJid)).catch(() => {})
}
