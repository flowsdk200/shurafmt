import { getRedis } from '../database/redis.js'

const SESSION_TTL_SEC = 25 * 60
const REDIS_NS = 'mangatoonread:session'
const makeKey = (chatJid) => `${REDIS_NS}:chat:${chatJid}`

const cleanUrl = (value) => {
    const raw = String(value || '').trim()
    return /^https?:\/\//i.test(raw) ? raw : ''
}

const toPayload = (payload = {}) => ({
    currentWatchUrl: cleanUrl(payload?.currentWatchUrl || payload?.currentUrl),
    nextEpisodeUrl: cleanUrl(payload?.nextEpisodeUrl || payload?.nextUrl),
    panelIndex: Number.parseInt(payload?.panelIndex || 0, 10) || 0,
    totalPanels: Number.parseInt(payload?.totalPanels || 0, 10) || 0,
    author: String(payload?.author || '').trim(),
    views: String(payload?.views || '').trim(),
    likes: String(payload?.likes || '').trim(),
    updatedAt: Date.now()
})

export const setMangatoonReadSession = async (chatJid, sender, payload = {}) => {
    const redis = await getRedis()
    if (!redis) return

    const key = makeKey(chatJid)
    const data = toPayload(payload)
    if (!data.currentWatchUrl && !data.nextEpisodeUrl) {
        await redis.del(key).catch(() => {})
        return
    }

    await redis.set(key, JSON.stringify(data), { EX: SESSION_TTL_SEC }).catch(() => {})
}

export const getMangatoonReadSession = async (chatJid, sender) => {
    const redis = await getRedis()
    if (!redis) return null

    const key = makeKey(chatJid)
    const raw = await redis.get(key).catch(() => null)
    if (!raw) return null

    try {
        const data = JSON.parse(raw)
        return {
            currentWatchUrl: cleanUrl(data?.currentWatchUrl),
            nextEpisodeUrl: cleanUrl(data?.nextEpisodeUrl),
            panelIndex: Number.parseInt(data?.panelIndex || 0, 10) || 0,
            totalPanels: Number.parseInt(data?.totalPanels || 0, 10) || 0,
            author: String(data?.author || '').trim(),
            views: String(data?.views || '').trim(),
            likes: String(data?.likes || '').trim(),
            updatedAt: Number.parseInt(data?.updatedAt || 0, 10) || Date.now()
        }
    } catch {
        await redis.del(key).catch(() => {})
        return null
    }
}

export const clearMangatoonReadSession = async (chatJid, sender) => {
    const redis = await getRedis()
    if (!redis) return
    await redis.del(makeKey(chatJid)).catch(() => {})
}
