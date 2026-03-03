import { makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore, Browsers } from 'baileys'
import pino from 'pino'
import { Boom } from '@hapi/boom'
import readline from 'readline'
import NodeCache from 'node-cache'
import fs from 'fs'
import path from 'path'
import util from 'util'
import logger from './src/utils/logger.js'
import config from './config.js'
import { handleMessage, loadPlugins } from './src/handler.js'
import store from './src/store.js'
import usersDb from './src/database/users.js'
import groupsDb from './src/database/groups.js'
import { closeMongo } from './src/database/mongo.js'
import { sendGreetingMessage } from './src/utils/greetings.js'
import { normalizeJid } from './src/utils/jid.js'

/** Simple readline interface for interactive pairing code request **/
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const question = (text) => new Promise((resolve) => rl.question(text, resolve))

const msgRetryCounterCache = new NodeCache()
let activeSock = null

const ownerJids = (config.ownerNumbers || [])
    .map((n) => String(n || '').replace(/[^0-9]/g, ''))
    .filter(Boolean)
    .map((n) => `${n}@s.whatsapp.net`)

const notifyOwnersError = async (title, err, extra = '') => {
    if (!activeSock || !ownerJids.length) return
    const detail = typeof err === 'string' ? err : util.format(err)
    const text = `BOT ERROR\n${title}\n\n${detail}${extra ? `\n\n${extra}` : ''}`.slice(0, 12000)

    for (const jid of ownerJids) {
        try {
            await activeSock.sendMessage(jid, {
                text,
                contextInfo: { isForwarded: true }
            })
        } catch {}
    }
}


async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(config.sessionName)

    const version = [2, 3000, 1034074495]
    logger.info(`Using WA v${version.join('.')}`)

    const socketConfig = {
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        msgRetryCounterCache,
        generateHighQualityLinkPreview: true,
        browser: Browsers.macOS("Chrome"),
        getMessage: async (key) => {
            const msg = store.getMessage(key)
            return msg?.message
        },
        cachedGroupMetadata: async () => undefined
    }

    const sock = makeWASocket(socketConfig)
    activeSock = sock
    sock.autoRead = config.autoRead !== false
    sock.public = !config.selfMode

    /** Disable custom group metadata cache to avoid stale admin checks on deployment env **/
    sock._groupCache = null
    store._groupCache = null

    /** Bind store ke semua socket events **/
    store.bind(sock.ev)

    if (!sock.authState.creds.registered) {
        let phoneNumber = await question('Please enter your WhatsApp phone number (e.g., 628xxxxxx): ')
        phoneNumber = phoneNumber.replace(/[^0-9]/g, '')

        /** Delay is required before requesting pairing code per docs **/
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber)
                logger.ready(`Pairing code: ${code?.match(/.{1,4}/g)?.join('-') || code}`)
            } catch (err) {
                logger.error(`Failed to request pairing code: ${err.message}`)
            }
        }, 3000)
    }

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update
        if (connection === 'close') {
            const statusCode = (lastDisconnect.error && lastDisconnect.error.output) ? lastDisconnect.error.output.statusCode : lastDisconnect.error?.statusCode
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== DisconnectReason.forbidden
            const isConflict = statusCode === 409 || lastDisconnect.error?.message?.includes('conflict')

            const errMessage = lastDisconnect.error?.message || lastDisconnect.error || 'Unknown error'
            logger.warn(`Connection closed due to: ${errMessage}, reconnecting: ${shouldReconnect}`)

            if (lastDisconnect.error) {
                // Log full detail to file via logger.warn/error
            }

            if (shouldReconnect) {
                const delay = isConflict ? 5000 : 3000
                if (isConflict) logger.info('Conflict detected! Waiting 5 seconds before reconnecting to clear old session...')
                setTimeout(connectToWhatsApp, delay)
            } else {
                /** Automatically delete session if logged out per User Rules **/
                logger.warn('Device logged out. Automatically deleting stored session...')
                try {
                    const sessionDir = path.resolve(`./${config.sessionName}`)
                    if (fs.existsSync(sessionDir)) {
                        fs.rmSync(sessionDir, { recursive: true, force: true })
                        logger.info('Session successfully deleted! Restarting bot to request new pairing code...')
                    }
                } catch (err) {
                    logger.error(`Failed to delete session: ${err.message}`)
                }
                setTimeout(connectToWhatsApp, 3000)
            }
        } else if (connection === 'open') {
            logger.ready('Connected to WhatsApp via shurainc baileys socket!')
        }
    })

    sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
        try {
            if (!id?.endsWith('@g.us')) return
            const rawList = Array.isArray(participants) ? participants : [participants]
            const participantList = rawList
                .map((p) => typeof p === 'string' ? p : (p?.id || p?.jid || p?.participant || ''))
                .filter(Boolean)
            if (!participantList.length) return

            if (action === 'promote' || action === 'demote') return

            const meta = await sock.groupMetadata(id).catch(() => null)
            const currentMembers = new Set((meta?.participants || [])
                .map((x) => normalizeJid(x.id) || x.id)
                .filter(Boolean))

            const defaultWelcome = config.groupDefaults?.welcome ?? true
            const defaultGoodbye = config.groupDefaults?.goodbye ?? true
            const welcomeOn = groupsDb.getSetting(id, 'welcome', defaultWelcome) === true
            const goodbyeOn = groupsDb.getSetting(id, 'goodbye', defaultGoodbye) === true

            for (const p of participantList) {
                const normalized = normalizeJid(p) || p
                const isJoin = action === 'add' ? true : action === 'remove' || action === 'leave' ? false : currentMembers.has(normalized)

                if ((isJoin && !welcomeOn) || (!isJoin && !goodbyeOn)) continue

                await sendGreetingMessage({
                    sock,
                    config,
                    groupId: id,
                    participant: p,
                    groupMetadata: meta,
                    isWelcome: isJoin === true
                })
            }
        } catch (err) {
            logger.warn(`Welcome/Goodbye handler failed: ${err.message}`)
        }
    })

    sock.ev.on('messages.upsert', async (m) => {
        if (sock.autoRead && m?.type === 'notify' && Array.isArray(m.messages)) {
            const readKeys = m.messages
                .filter((x) => x?.key?.id && !x.key.fromMe && x.key.remoteJid !== 'status@broadcast')
                .map((x) => x.key)
            if (readKeys.length) {
                try {
                    await sock.readMessages(readKeys)
                } catch (err) {
                    logger.warn(`Auto-read failed: ${err.message}`)
                }
            }
        }
        await handleMessage(sock, m)
    })
}

/** Catch uncaught exceptions to prevent crashing **/
process.on('uncaughtException', (err) => {
    logger.error(`Uncaught Exception: ${err.message}\nStack: ${err.stack}`)
    notifyOwnersError('uncaughtException', err)
})

process.on('unhandledRejection', (reason, promise) => {
    logger.error(`Unhandled Rejection at: ${promise}\nReason: ${reason}`)
    notifyOwnersError('unhandledRejection', reason)
})

const shutdown = async (signal) => {
    try {
        logger.warn(`Received ${signal}, shutting down gracefully...`)
        await closeMongo()
        rl.close()
        process.exit(0)
    } catch (err) {
        logger.error(`Shutdown failed: ${err?.message || err}`)
        process.exit(1)
    }
}

process.on('SIGTERM', () => { shutdown('SIGTERM') })
process.on('SIGINT', () => { shutdown('SIGINT') })

async function start() {
    await usersDb.init()
    await groupsDb.init()
    await loadPlugins()
    await connectToWhatsApp()
}

start().catch((err) => {
    logger.error(`Startup failed: ${err?.message || err}`)
    notifyOwnersError('startup', err)
})
