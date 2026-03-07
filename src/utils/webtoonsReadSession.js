import { getRedis } from '../database/redis.js'

const SESSION_TTL_SEC = 25 * 60
const REDIS_NS = 'webtoonsread:session'
const makeKey = (chatJid) => `${REDIS_NS}:chat:${chatJid}`

const cleanUrl = (value) => {
    const raw = String(value || '').trim()
    return /^https?:\/\//i.test(raw) ? raw : ''
}

const toPayload = (payload = {}) => ({
    currentViewerUrl: cleanUrl(payload?.currentViewerUrl || payload?.currentUrl),
    nextEpisodeUrl: cleanUrl(payload?.nextEpisodeUrl || payload?.nextUrl),
    panelIndex: Number.parseInt(payload?.panelIndex || 0, 10) || 0,
    totalPanels: Number.parseInt(payload?.totalPanels || 0, 10) || 0,
    updatedAt: Date.now()
})

export const setWebtoonsReadSession = async (chatJid, sender, payload = {}) => {
    const redis = await getRedis()
    if (!redis) return

    const key = makeKey(chatJid)
    const data = toPayload(payload)
    if (!data.currentViewerUrl && !data.nextEpisodeUrl) {
        await redis.del(key).catch(() => {})
        return
    }

    await redis.set(key, JSON.stringify(data), { EX: SESSION_TTL_SEC }).catch(() => {})
}

export const getWebtoonsReadSession = async (chatJid, sender) => {
    const redis = await getRedis()
    if (!redis) return null

    const key = makeKey(chatJid)
    const raw = await redis.get(key).catch(() => null)
    if (!raw) return null

    try {
        const data = JSON.parse(raw)
        return {
            currentViewerUrl: cleanUrl(data?.currentViewerUrl),
            nextEpisodeUrl: cleanUrl(data?.nextEpisodeUrl),
            panelIndex: Number.parseInt(data?.panelIndex || 0, 10) || 0,
            totalPanels: Number.parseInt(data?.totalPanels || 0, 10) || 0,
            updatedAt: Number.parseInt(data?.updatedAt || 0, 10) || Date.now()
        }
    } catch {
        await redis.del(key).catch(() => {})
        return null
    }
}

export const clearWebtoonsReadSession = async (chatJid, sender) => {
    const redis = await getRedis()
    if (!redis) return
    await redis.del(makeKey(chatJid)).catch(() => {})
}
