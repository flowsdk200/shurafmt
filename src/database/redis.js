import config from '../../config.js'
import logger from '../utils/logger.js'

let client = null
let connectPromise = null
let invalidWarned = false
let failedWarned = false
let moduleWarned = false
let createRedisClient = null

const getRawRedisUrl = () =>
    String(config.redisUrl || '')
        .trim()
        .replace(/^['"]|['"]$/g, '')

const isValidRedisUrl = (url) => url.startsWith('redis://') || url.startsWith('rediss://')

export const connectRedis = async () => {
    if (client?.isReady) return client
    if (connectPromise) return connectPromise

    const url = getRawRedisUrl()
    if (!url) return null
    if (!isValidRedisUrl(url)) {
        if (!invalidWarned) {
            invalidWarned = true
            logger.warn('config.redisUrl tidak valid. Gunakan redis:// atau rediss://')
        }
        return null
    }

    if (!createRedisClient) {
        try {
            const mod = await import('redis')
            createRedisClient = mod.createClient
        } catch (err) {
            if (!moduleWarned) {
                moduleWarned = true
                logger.warn(`Modul redis belum terpasang: ${err.message}`)
            }
            return null
        }
    }

    connectPromise = (async () => {
        try {
            const next = createRedisClient({
                url,
                pingInterval: 10000,
                socket: {
                    connectTimeout: 8000,
                    keepAlive: 5000,
                    reconnectStrategy: (retries) => Math.min(250 * Math.max(retries, 1), 5000)
                }
            })

            next.on('error', (err) => {
                if (!failedWarned) {
                    failedWarned = true
                    logger.warn(`Redis error: ${err.message}`)
                }
            })
            next.on('end', () => {
                client = null
                logger.warn('Koneksi Redis terputus. Mencoba sambung ulang otomatis...')
            })
            next.on('reconnecting', () => {
                logger.info('Redis reconnecting...')
            })

            await next.connect()
            client = next
            failedWarned = false
            logger.ready('Redis siap')
            return client
        } catch (err) {
            if (!failedWarned) {
                failedWarned = true
                logger.warn(`Gagal konek Redis: ${err.message}`)
            }
            client = null
            return null
        } finally {
            connectPromise = null
        }
    })()

    return connectPromise
}

export const getRedis = async () => {
    if (client?.isReady) return client
    return connectRedis()
}

export const closeRedis = async () => {
    if (!client) return
    try {
        await client.quit()
    } catch {}
    client = null
}
