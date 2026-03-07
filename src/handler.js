import fs from 'fs'
import os from 'os'
import path from 'path'
import util from 'util'
import { fileURLToPath } from 'url'
import NodeCache from 'node-cache'
import { isJidNewsletter } from 'baileys'
import config from '../config.js'
import logger from './utils/logger.js'
import usersDb from './database/users.js'
import groupsDb from './database/groups.js'
import { normalizeJid, cacheLidMapping } from './utils/jid.js'
import { getWpreadSession } from './utils/wpreadSession.js'
import { getWebtoonsReadSession } from './utils/webtoonsReadSession.js'
import { getMangatoonReadSession } from './utils/mangatoonReadSession.js'

const messageIdCache = new NodeCache({ stdTTL: 5 * 60, useClones: false })
const antispamCache = new NodeCache({ stdTTL: 15, useClones: false })
const antispamWarnCache = new NodeCache({ stdTTL: 5, useClones: false })
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginsDir = path.join(__dirname, '../plugins')

const getUptime = (uptimeSeconds) => {
    const total = Math.max(0, Math.floor(Number(uptimeSeconds) || 0))
    if (total < 60) return `${total} seconds`
    if (total < 3600) return `${Math.floor(total / 60)} minutes`
    if (total < 86400) return `${Math.floor(total / 3600)} hours`
    return `${Math.floor(total / 86400)} days`
}

/** Load plugins dynamically **/
const plugins = new Map()

const loadPlugins = async () => {
    try {
        if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir)

        const getFiles = (dir) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true })
            const files = entries
                .filter(file => !file.isDirectory() && file.name.endsWith('.js'))
                .map(file => path.join(dir, file.name))
            const folders = entries.filter(file => file.isDirectory())
            for (const folder of folders) {
                files.push(...getFiles(path.join(dir, folder.name)))
            }
            return files
        }

        const files = getFiles(pluginsDir)

        for (const file of files) {
            const pluginPath = `file://${file}`
            const module = await import(pluginPath)

            if (module.default && module.default.name) {
                plugins.set(module.default.name, module.default)
            }
        }
        logger.info(`Loaded ${plugins.size} plugins`)
    } catch (err) {
        logger.error(`Failed to load plugins: ${err.message}`)
    }
}

/** Initial load - removed to be called after login manually **/
// loadPlugins()

export { loadPlugins }

/** Main message handler **/
export const handleMessage = async (sock, m) => {
    try {
        if (!m.messages || !m.messages[0]) return
        const msg = m.messages[0]
        if (!msg.key.id) return

        /** Ignore status broadcast. Allow newsletter updates and non-notify newsletter upserts. **/
        const isNewsletterMsg = !!isJidNewsletter(msg.key.remoteJid)
        if (msg.key.remoteJid === 'status@broadcast') return

        /** /^3E.{20}$/ = web/baileys device fingerprint (confirmed dari id=3EB02341C1DFA4788543E8) **/
        if (!msg.key.fromMe && msg.key.remoteJid?.endsWith('@g.us') && /^3E.{20}$/.test(msg.key.id)) {
            const antibotOn = groupsDb.getSetting(msg.key.remoteJid, 'antibot', false) === true
            if (antibotOn) {
                try {
                    const rawParticipant = msg.key.participant
                    const botJidNorm = sock.user?.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : null
                    const meta = await sock.groupMetadata(msg.key.remoteJid)
                    const isBotAdminNow = botJidNorm && meta?.participants?.some(p => normalizeJid(p.id) === botJidNorm && p.admin)
                    if (isBotAdminNow && rawParticipant) {
                        await sock.groupParticipantsUpdate(msg.key.remoteJid, [rawParticipant], 'remove')
                        logger.info(`[ANTIBOT] kicked bot participant=${rawParticipant} jid=${msg.key.remoteJid}`)
                    }
                } catch (err) {
                    logger.warn(`[ANTIBOT] kick failed: ${err.message}`)
                }
                return
            }
        }

        if (!isNewsletterMsg && m.type !== 'notify') return

        /** Izinkan fromMe hanya jika nomor bot adalah owner (kirim command dari device bot sendiri) **/
        if (msg.key.fromMe) {
            const botNum = sock.user?.id?.split(':')[0]
            if (!config.ownerNumbers.includes(botNum)) return
        }

        /** Deduplicate messages to prevent double processing/logging **/
        if (messageIdCache.has(msg.key.id)) return
        messageIdCache.set(msg.key.id, true)

        /** Extract message type — skip metadata-only keys bawaan WA.
         *  Juga unwrap wrapper types (viewOnce, ephemeral, documentWithCaption, edited)
         *  agar content message di dalamnya bisa diproses normal. **/
        const NON_CONTENT_KEYS = [
            'messageContextInfo', 'senderKeyDistributionMessage', 'deviceSentMessage',
            'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension',
            'ephemeralMessage', 'documentWithCaptionMessage', 'editedMessage',
            'lottieStickerMessage', 'encReactionMessage', 'pollCreationMessage',
            'pollCreationMessageV2', 'pollCreationMessageV3', 'pollUpdateMessage',
            'requestPaymentMessage', 'sendPaymentMessage', 'declinePaymentRequestMessage',
            'cancelPaymentRequestMessage', 'callLogMesssage', 'pinInChatMessage',
            'encCommentMessage', 'groupMentionedMessage', 'scheduledCallCreationMessage',
            'scheduledCallEditMessage', 'botInvokeMessage',
        ]

        /** Unwrap wrapper types secara rekursif satu level **/
        let rawMessage = msg.message || {}
        const WRAPPER_TYPES = [
            'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension',
            'ephemeralMessage', 'documentWithCaptionMessage', 'editedMessage',
        ]
        for (const wt of WRAPPER_TYPES) {
            if (rawMessage[wt]?.message) {
                rawMessage = rawMessage[wt].message
                break
            }
        }

        const allMsgKeys = Object.keys(rawMessage)
        const type = allMsgKeys.find(k => !NON_CONTENT_KEYS.includes(k)) || allMsgKeys[0]
        if (!type) return

        let body = ''
        let mimetype = ''
        let nextPartInteractiveHint = false
        let nextWebtoonsInteractiveHint = false
        let deleteInteractiveButton = false
        let deleteButtonMessageKey = null

        const getDeleteMessageKeyFromContext = (context, remoteJid) => {
            const stanzaId = context?.stanzaId?.trim() || context?.key?.id?.trim() || ''
            if (!stanzaId || !remoteJid) return null

            return {
                remoteJid,
                id: stanzaId,
                fromMe: true
            }
        }

        if (type === 'conversation') {
            body = rawMessage.conversation
        } else if (type === 'extendedTextMessage') {
            body = rawMessage.extendedTextMessage.text
        } else if (type === 'imageMessage') {
            body = rawMessage.imageMessage.caption || ''
            mimetype = rawMessage.imageMessage.mimetype
        } else if (type === 'videoMessage') {
            body = rawMessage.videoMessage.caption || ''
            mimetype = rawMessage.videoMessage.mimetype
        } else if (type === 'audioMessage') {
            mimetype = rawMessage.audioMessage.mimetype
        } else if (type === 'documentMessage') {
            mimetype = rawMessage.documentMessage.mimetype
        } else if (type === 'stickerMessage') {
            mimetype = rawMessage.stickerMessage.mimetype
        } else if (type === 'listResponseMessage') {
            /** User memilih item dari single_select list — selectedRowId berisi ID yang kita set di menu **/
            body = rawMessage.listResponseMessage?.singleSelectReply?.selectedRowId || ''
        } else if (type === 'interactiveResponseMessage') {
            /** User mengetuk button interaktif — coba ambil dari nativeFlowResponseMessage atau selectedButtonId **/
            const resp = rawMessage.interactiveResponseMessage
            const toWpreadCommand = (rawValue) => {
                if (!rawValue || typeof rawValue !== 'string') return ''

                const trimmed = rawValue.trim()
                if (!trimmed) return ''

                if (trimmed.startsWith('wpr:')) {
                    const match = trimmed.match(/^wpr:(\d+):(\d+)$/)
                    if (!match) return ''
                    return `.wpread ${match[1]} ${match[2]}`
                }

                if (/^wtr:next$/i.test(trimmed)) return '.webtoonread next'
                if (/^mtr:next$/i.test(trimmed)) return '.mangatoonread next'
                if (trimmed.startsWith('wtr:')) {
                    const encoded = trimmed.slice(4).trim()
                    if (!encoded) return ''
                    try {
                        const nextUrl = decodeURIComponent(encoded)
                        if (!/^https?:\/\//i.test(nextUrl)) return ''
                        return `.webtoonread ${nextUrl}`
                    } catch {
                        return ''
                    }
                }

                if (/^\.wpread\b/i.test(trimmed)) return trimmed
                if (/^\.(webtoonread|webtoonsread|wtr)\b/i.test(trimmed)) return trimmed
                if (/^\.(mangatoonread|mtr)\b/i.test(trimmed)) return trimmed

                if (/^NEXT PANEL\b/i.test(trimmed) || /^part\b/i.test(trimmed)) {
                    nextPartInteractiveHint = true
                    return ''
                }

                if (/^NEXT EPISODE\b/i.test(trimmed) || /^episode\b/i.test(trimmed)) {
                    nextWebtoonsInteractiveHint = true
                    return ''
                }

                return ''
            }

            const normalizeCandidate = (candidate) => {
                if (!candidate || typeof candidate !== 'string') return ''

                const rawText = candidate.trim()
                if (!rawText) return ''

                if (rawText.startsWith('{') && rawText.endsWith('}')) {
                    try {
                        const parsed = JSON.parse(rawText)
                        return toWpreadCommand(parsed?.id || parsed?.selectedId || parsed?.display_text || parsed?.buttonId || parsed?.text)
                    } catch {
                        return ''
                    }
                }

                return toWpreadCommand(rawText)
            }

            const candidateInputs = [
                resp?.nativeFlowResponseMessage?.paramsJson,
                resp?.selectedButtonId,
                resp?.selectedId,
                resp?.buttonId,
                resp?.selected_button_id,
                resp?.selectedDisplayText,
                resp?.selectedText,
                resp?.body
            ]

            for (const candidate of candidateInputs) {
                const normalized = normalizeCandidate(candidate)
                if (normalized) {
                    body = normalized
                    deleteInteractiveButton = true
                    break
                }
            }
        } else if (type === 'buttonsResponseMessage') {
            /** Legacy button response fallback. **/
            const resp = rawMessage.buttonsResponseMessage
            const toWpreadCommand = (rawValue) => {
                if (!rawValue || typeof rawValue !== 'string') return ''

                const trimmed = rawValue.trim()
                if (!trimmed) return ''

                if (trimmed.startsWith('wpr:')) {
                    const match = trimmed.match(/^wpr:(\d+):(\d+)$/)
                    if (!match) return ''
                    return `.wpread ${match[1]} ${match[2]}`
                }

                if (/^wtr:next$/i.test(trimmed)) return '.webtoonread next'
                if (/^mtr:next$/i.test(trimmed)) return '.mangatoonread next'
                if (trimmed.startsWith('wtr:')) {
                    const encoded = trimmed.slice(4).trim()
                    if (!encoded) return ''
                    try {
                        const nextUrl = decodeURIComponent(encoded)
                        if (!/^https?:\/\//i.test(nextUrl)) return ''
                        return `.webtoonread ${nextUrl}`
                    } catch {
                        return ''
                    }
                }

                if (/^\.wpread\b/i.test(trimmed)) return trimmed
                if (/^\.(webtoonread|webtoonsread|wtr)\b/i.test(trimmed)) return trimmed
                if (/^\.(mangatoonread|mtr)\b/i.test(trimmed)) return trimmed

                if (/^NEXT PANEL\b/i.test(trimmed) || /^part\b/i.test(trimmed)) {
                    nextPartInteractiveHint = true
                    return ''
                }

                if (/^NEXT EPISODE\b/i.test(trimmed) || /^episode\b/i.test(trimmed)) {
                    nextWebtoonsInteractiveHint = true
                    return ''
                }

                return ''
            }

            const candidates = [
                resp?.selectedButtonId,
                resp?.selectedId,
                resp?.selectedButtonDisplayText,
                resp?.selectedDisplayText,
                resp?.body
            ]
            for (const candidate of candidates) {
                const normalized = toWpreadCommand(candidate)
                if (normalized) {
                    body = normalized
                    deleteInteractiveButton = true
                    break
                }
            }
        } else if (type === 'templateButtonReplyMessage') {
            /** Fallback for template button responses. **/
            const resp = rawMessage.templateButtonReplyMessage
            const toWpreadCommand = (rawValue) => {
                if (!rawValue || typeof rawValue !== 'string') return ''

                const trimmed = rawValue.trim()
                if (!trimmed) return ''

                if (trimmed.startsWith('wpr:')) {
                    const match = trimmed.match(/^wpr:(\d+):(\d+)$/)
                    if (!match) return ''
                    return `.wpread ${match[1]} ${match[2]}`
                }

                if (/^wtr:next$/i.test(trimmed)) return '.webtoonread next'
                if (/^mtr:next$/i.test(trimmed)) return '.mangatoonread next'
                if (trimmed.startsWith('wtr:')) {
                    const encoded = trimmed.slice(4).trim()
                    if (!encoded) return ''
                    try {
                        const nextUrl = decodeURIComponent(encoded)
                        if (!/^https?:\/\//i.test(nextUrl)) return ''
                        return `.webtoonread ${nextUrl}`
                    } catch {
                        return ''
                    }
                }

                if (/^\.wpread\b/i.test(trimmed)) return trimmed
                if (/^\.(webtoonread|webtoonsread|wtr)\b/i.test(trimmed)) return trimmed
                if (/^\.(mangatoonread|mtr)\b/i.test(trimmed)) return trimmed

                if (/^NEXT PANEL\b/i.test(trimmed) || /^part\b/i.test(trimmed)) {
                    nextPartInteractiveHint = true
                    return ''
                }

                if (/^NEXT EPISODE\b/i.test(trimmed) || /^episode\b/i.test(trimmed)) {
                    nextWebtoonsInteractiveHint = true
                    return ''
                }

                return ''
            }

            const candidates = [
                resp?.selectedId,
                resp?.selectedDisplayText,
                resp?.selectedButtonId,
                resp?.body
            ]

            for (const candidate of candidates) {
                const normalized = toWpreadCommand(candidate)
                if (normalized) {
                    body = normalized
                    deleteInteractiveButton = true
                    break
                }
            }
        }

        if (deleteInteractiveButton) {
            deleteButtonMessageKey = getDeleteMessageKeyFromContext(
                rawMessage.interactiveResponseMessage?.contextInfo ||
                rawMessage.buttonsResponseMessage?.contextInfo ||
                rawMessage.templateButtonReplyMessage?.contextInfo ||
                null,
                msg.key.remoteJid
            )
        }

        /** Extract Sender and Group Info **/
        const isGroup = msg.key.remoteJid.endsWith('@g.us')
        let rawSender
        if (msg.key.fromMe) {
            /** fromMe: sender adalah bot itu sendiri — ambil dari sock.user, bukan remoteJid.
             *  Guard null: sock.user bisa null saat koneksi belum selesai — jangan concatenate undefined. **/
            rawSender = isGroup
                ? msg.key.participant
                : (sock.user?.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : null)
        } else {
            rawSender = isGroup ? msg.key.participant : msg.key.remoteJid
        }
        const sender = normalizeJid(rawSender)

        /** Guard: system messages tanpa sender (mis. group notification) **/
        if (!sender) return
        const pushName = msg.pushName || 'User'
        /** Guard null: jangan buat "undefined@s.whatsapp.net" jika sock.user belum populated **/
        const botJid = sock.user?.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : null
        if (!botJid) return

        if (!body && nextPartInteractiveHint) {
            const wpState = await getWpreadSession(msg.key.remoteJid, sender)
            if (wpState?.storyId) {
                const totalParts = Math.max(Number.parseInt(wpState.totalParts, 10) || 0, 0)
                const currentPart = Math.max(Number.parseInt(wpState.part, 10) || 1, 1)
                const nextPart = totalParts > 0 && currentPart < totalParts ? currentPart + 1 : 0

                if (nextPart) {
                    body = `.wpread ${wpState.storyId} ${nextPart}`
                    deleteInteractiveButton = true
                } else {
                    deleteInteractiveButton = false
                }
            }
        }

        if (!body && (nextWebtoonsInteractiveHint || nextPartInteractiveHint)) {
            const webtoonsState = await getWebtoonsReadSession(msg.key.remoteJid, sender)
            const currentViewerUrl = String(webtoonsState?.currentViewerUrl || '').trim()
            const nextEpisodeUrl = String(webtoonsState?.nextEpisodeUrl || '').trim()
            if (/^https?:\/\//i.test(currentViewerUrl) || /^https?:\/\//i.test(nextEpisodeUrl)) {
                body = '.webtoonread next'
                deleteInteractiveButton = true
            }
        }

        if (!body && nextPartInteractiveHint) {
            const mangatoonState = await getMangatoonReadSession(msg.key.remoteJid, sender)
            const currentWatchUrl = String(mangatoonState?.currentWatchUrl || '').trim()
            const nextEpisodeUrl = String(mangatoonState?.nextEpisodeUrl || '').trim()
            if (/^https?:\/\//i.test(currentWatchUrl) || /^https?:\/\//i.test(nextEpisodeUrl)) {
                body = '.mangatoonread next'
                deleteInteractiveButton = true
            }
        }

        if (deleteInteractiveButton && deleteButtonMessageKey) {
            await sock.sendMessage(msg.key.remoteJid, {
                delete: deleteButtonMessageKey
            }).catch(() => {})
        }

        const toUserKey = (jid) => String(normalizeJid(jid) || jid || '').split('@')[0].split(':')[0]
        const isAdminInMeta = (meta, targetJid) => {
            const target = toUserKey(targetJid)
            if (!target || !Array.isArray(meta?.participants)) return false
            return meta.participants.some((p) => {
                if (!p?.admin) return false
                const idKey = toUserKey(p.id)
                const phoneKey = toUserKey(p.phoneNumber)
                return idKey === target || phoneKey === target
            })
        }

        const getGroupMetadata = async (jid) => {
            try {
                const meta = await sock.groupMetadata(jid)

                /** surabails punya todo resmi di groups.js:315 — tidak otomatis simpan
                 *  LID mapping saat groupMetadata di-fetch. Kita isi lidCache manual di sini:
                 *  setiap participant yang punya phoneNumber (LID-mode grup) langsung di-cache
                 *  sehingga normalizeJid bisa resolve @lid → @s.whatsapp.net tanpa baca file. **/
                if (meta?.participants) {
                    for (const p of meta.participants) {
                        if (p.id?.endsWith('@lid') && p.phoneNumber?.endsWith('@s.whatsapp.net')) {
                            cacheLidMapping(p.id, p.phoneNumber)
                        }
                    }
                }

                return meta
            } catch (err) {
                logger.warn(`groupMetadata fetch failed for ${jid}: ${err.message}`)
                return null
            }
        }

        let groupMetadata = null
        let isAdmin = false
        let isBotAdmin = false
        let groupMetadataPromise = null
        const ensureGroupMetadata = async () => {
            if (!isGroup) return null
            if (groupMetadata) return groupMetadata
            if (groupMetadataPromise) return groupMetadataPromise

            groupMetadataPromise = getGroupMetadata(msg.key.remoteJid)
                .then((meta) => {
                    groupMetadata = meta
                    return meta
                })
                .catch(() => null)
                .finally(() => { groupMetadataPromise = null })

            return groupMetadataPromise
        }
        const ensureGroupFlags = async () => {
            const meta = await ensureGroupMetadata()
            if (!meta) return
            isAdmin = isAdminInMeta(meta, sender)
            isBotAdmin = isAdminInMeta(meta, botJid)
        }

        // Persist group info for future group features.
        if (isGroup) {
            groupsDb.recordMessage(msg.key.remoteJid, groupMetadata?.subject || '', groupMetadata)
        }

        const react = (emoji) => sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } })

        /** Catat SEMUA pesan user (termasuk media tanpa caption) + auto-register **/
        const user = usersDb.recordMessage(sender, pushName)

        /** Blokir user yang di-ban (kecuali owner) **/
        const isOwner = config.ownerNumbers.includes(sender.split('@')[0]) || usersDb.isOwner(sender)
        if (usersDb.isBanned(sender) && !isOwner) return

        /** Sync owner status from config to DB **/
        if (config.ownerNumbers.includes(sender.split('@')[0]) && !user.owner) {
            usersDb.addOwner(sender)
        }

        const isPremium = usersDb.isPremium(sender)

        if (isGroup) {
            const defaultAntiLuar = config.groupDefaults?.antiluar ?? false
            const antiLuarOn = groupsDb.getSetting(msg.key.remoteJid, 'antiluar', defaultAntiLuar) === true
            const numPrefix = String(config.numPrefix || '62').replace(/[^0-9]/g, '') || '62'
            const participantAlt = normalizeJid(msg.key.participantAlt) || msg.key.participantAlt || ''
            const senderJidForAntiLuar = participantAlt || sender
            const senderPhone = String(
                participantAlt.split('@')[0] ||
                sender.split('@')[0] ||
                ''
            ).replace(/[^0-9]/g, '')

            if (antiLuarOn && senderPhone && !senderPhone.startsWith(numPrefix)) {
                await ensureGroupFlags()

                const kickCandidates = [...new Set([
                    participantAlt,
                    senderJidForAntiLuar,
                    sender,
                    msg.key.participant || '',
                    `${senderPhone}@s.whatsapp.net`
                ].filter(Boolean))]

                const protectedSender =
                    isOwner ||
                    isPremium ||
                    isAdmin ||
                    kickCandidates.includes(botJid)

                if (!protectedSender) {
                    let removed = false

                    for (const target of kickCandidates) {
                        const results = await sock.groupParticipantsUpdate(msg.key.remoteJid, [target], 'remove').catch(() => null)
                        const result = results?.[0]
                        if (String(result?.status || '') === '200') {
                            removed = true
                            break
                        }
                    }

                    if (removed) {
                        await sock.sendMessage(msg.key.remoteJid, {
                            text: `@${senderPhone} otomatis dikeluarkan karena antiluar aktif.`,
                            mentions: [`${senderPhone}@s.whatsapp.net`]
                        }, { quoted: msg }).catch(() => {})
                        return
                    }
                }
            }
        }

        if (isGroup && body) {
            const antiLinkGcOn = groupsDb.getSetting(msg.key.remoteJid, 'antilinkgc', false) === true
            const antiLinkChOn = groupsDb.getSetting(msg.key.remoteJid, 'antilinkch', false) === true

            if (antiLinkGcOn || antiLinkChOn) {
                const groupLinkRegex = /(?:https?:\/\/)?chat\.whatsapp\.com\/([A-Za-z0-9]{20,32})/ig
                const channelLinkRegex = /(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/([0-9A-Za-z]+)/ig
                const groupMatches = [...body.matchAll(groupLinkRegex)]
                const channelMatches = [...body.matchAll(channelLinkRegex)]
                const hasGroupLink = antiLinkGcOn && groupMatches.length > 0
                const hasChannelLink = antiLinkChOn && channelMatches.length > 0

                if (hasGroupLink || hasChannelLink) {
                    await ensureGroupFlags()

                    if (!isOwner && !isPremium && !isAdmin && isBotAdmin) {
                        const currentInviteCode = String(groupMetadata?.inviteCode || groupsDb.getGroup(msg.key.remoteJid)?.inviteCode || '').trim()
                        const ownChannelLink = String(config.channelLink || '').trim().toLowerCase().replace(/^https?:\/\//, '')
                        const isOwnGroupLink = hasGroupLink && !!currentInviteCode && groupMatches.some((m) => String(m[1] || '').trim() === currentInviteCode)
                        const isOwnChannelLink = hasChannelLink && !!ownChannelLink && channelMatches.some((m) => String(m[0] || '').trim().toLowerCase().replace(/^https?:\/\//, '') === ownChannelLink)

                        if (!isOwnGroupLink && !isOwnChannelLink) {
                            await sock.sendMessage(msg.key.remoteJid, { delete: msg.key }).catch(() => {})
                            /*
                            const reason = hasGroupLink ? 'link grup' : 'link channel'
                            
                            await sock.sendMessage(msg.key.remoteJid, {
                                text: `❌ Pesan @${sender.split('@')[0]} dihapus karena mengirim ${reason}.`,
                                mentions: [sender]
                            }, { quoted: msg }).catch(() => {})
                            */
                            return
                        }
                    }
                }
            }
        }

        const restrictionMode = config.onlyGroup
            ? 'onlygroup'
            : config.onlyPrivate
                ? 'onlyprivate'
                : config.onlyOwner
                    ? 'onlyowner'
                    : config.onlyPremium
                        ? 'onlypremium'
                        : ''
        const isAccessRestricted =
            restrictionMode === 'onlygroup'
                ? (!isOwner && !isPremium && !isGroup)
                : restrictionMode === 'onlyprivate'
                    ? (!isOwner && !isPremium && isGroup)
                    : restrictionMode === 'onlyowner'
                        ? !isOwner
                        : restrictionMode === 'onlypremium'
                            ? (!isOwner && !isPremium)
                            : false

        const sendContextRestrictionMessage = async () => {
            const senderNumber = sender.split('@')[0]
            const ownerNumber = String(config.ownerNumbers?.[0] || '').replace(/[^0-9]/g, '')
            const ownerJid = ownerNumber ? `${ownerNumber}@s.whatsapp.net` : undefined
            const groupLink = global.linkgc || config.linkgc || '-'

            const text = restrictionMode === 'onlygroup'
                ? ` 「 ❌ 」 AKSES DITOLAK 「 ❌ 」\n\n👋 Hey @${senderNumber}, perintah kamu ditolak karena bot ini dibatasi hanya untuk grup.\n\nCara memakai bot:\n1) Masuk ke grup resmi: ${groupLink}\n2) Kirim perintah di dalam grup.\n\nPengecualian:\n• Owner & premium user \n(keduanya tetap bisa memakai bot di chat pribadi.)\n\nKebijakan ini dibuat agar layanan bot tertib, mengurangi spam, dan menjaga kestabilan sistem.\n\nterima kasih atas pengertiannya.`
                : restrictionMode === 'onlyprivate'
                    ? ` 「 ❌ 」 AKSES DITOLAK 「 ❌ 」\n\n👋 Hey @${senderNumber}, perintah kamu ditolak karena bot ini dibatasi hanya untuk chat pribadi.\n\nCara memakai bot:\n1) Buka chat pribadi bot.\n2) Kirim perintah di chat pribadi.\n\nPengecualian:\n• Owner & premium user \n(keduanya tetap bisa memakai bot di grup.)\n\nKebijakan ini dibuat agar layanan bot tertib, mengurangi spam, dan menjaga kestabilan sistem.\n\nterima kasih atas pengertiannya.`
                    : restrictionMode === 'onlyowner'
                        ? ` 「 ❌ 」 AKSES DITOLAK 「 ❌ 」\n\n👋 Hey @${senderNumber}, perintah kamu ditolak karena bot ini sedang dibatasi hanya untuk owner.\n\nYang masih bisa memakai bot:\n• Owner bot\n\nKalau kamu bukan owner:\n• Semua akses bot memang sedang ditutup untuk user lain.\n• Hubungi owner kalau memang perlu dibukakan akses.\n\nKebijakan ini dibuat agar layanan bot tertib, mengurangi spam, dan menjaga kestabilan sistem.\n\nterima kasih atas pengertiannya.`
                        : ` 「 ❌ 」 AKSES DITOLAK 「 ❌ 」\n\n👋 Hey @${senderNumber}, perintah kamu ditolak karena bot ini sedang dibatasi hanya untuk owner dan pengguna premium.\n\nYang masih bisa memakai bot:\n• Owner bot\n• Premium user\n\nKalau kamu masih user free:\n• Akses bot memang sedang ditutup untuk user free.\n• Upgrade ke premium atau hubungi owner jika perlu akses.\n\nKebijakan ini dibuat agar layanan bot tertib, mengurangi spam, dan menjaga kestabilan sistem.\n\nterima kasih atas pengertiannya.`

            return sock.sendMessage(msg.key.remoteJid, {
                text,
                contextInfo: {
                    mentionedJid: [sender],
                    forwardingScore: 999,
                    isForwarded: true,
                    externalAdReply: {
                        title: `${config.botName} wabot - v1.0.0`,
                        body: `system uptime: ${getUptime(os.uptime())}`,
                        thumbnail: config.thumb,
                        mediaType: 1,
                        renderLargerThumbnail: true
                    },
                    ...(ownerJid ? {
                        businessMessageForwardInfo: {
                            businessOwnerJid: ownerJid
                        }
                    } : {})
                }
            }, { quoted: msg })
        }

        /** Group antispam guard (config disimpan di groups DB). */
        if (isGroup) {
            if (!isOwner && groupsDb.isUserMuted(msg.key.remoteJid, sender)) {
                const muteExpiry = groupsDb.getUserMuteExpiry(msg.key.remoteJid, sender)
                const warnKey = `${msg.key.remoteJid}:muted:${sender}`
                if (!antispamWarnCache.has(warnKey)) {
                    antispamWarnCache.set(warnKey, true)
                    const until = new Date(muteExpiry).toLocaleString('id-ID', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                        timeZone: 'Asia/Jakarta'
                    })
                    /*
                    await sock.sendMessage(msg.key.remoteJid, {
                        text: `🔇 @${sender.split('@')[0]} sedang di-mute dari penggunaan bot sampai ${until}.`,
                        mentions: [sender]
                    }, { quoted: msg })
                    */
                }
                return
            }

            const antiSpamOn = groupsDb.getSetting(msg.key.remoteJid, 'antispam', false) === true
            if (antiSpamOn && !isOwner && !isAdmin) {
                await ensureGroupFlags()
                const isCommandText = !!body && config.prefixes.some((p) => body.startsWith(p))
                if (!isCommandText) return

                const key = `${msg.key.remoteJid}:${sender}`
                const now = Date.now()
                const hits = (antispamCache.get(key) || []).filter((t) => now - t <= 8000)
                hits.push(now)
                antispamCache.set(key, hits)

                if (hits.length >= 6) {
                    const warnKey = `${msg.key.remoteJid}:warn:${sender}`
                    const expiry = groupsDb.muteUser(msg.key.remoteJid, sender, 24 * 60 * 60 * 1000)
                    if (!antispamWarnCache.has(warnKey)) {
                        antispamWarnCache.set(warnKey, true)
                        const until = new Date(expiry).toLocaleString('id-ID', {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                            timeZone: 'Asia/Jakarta'
                        })
                        await sock.sendMessage(msg.key.remoteJid, {
                            text: `⚠️ @${sender.split('@')[0]} terdeteksi spam dan otomatis di-mute dari bot selama 24 jam (sampai ${until}).`,
                            mentions: [sender]
                        }, { quoted: msg })
                    }
                    return
                }
            }
        }

        /** Check for quoted messages — stanzaId membuktikan ini reply sungguhan,
         *  bukan sekadar contextInfo dari forwarded/device message.
         *  Semua message types yang support reply punya contextInfo di field utamanya. **/
        const contextInfo = rawMessage[type]?.contextInfo ?? null
        const isQuoted = !!contextInfo?.stanzaId
        let quotedMsg = null
        let quotedType = null
        let quotedMimetype = ''

        if (isQuoted) {
            quotedMsg = contextInfo.quotedMessage
            if (quotedMsg) {
                quotedType = Object.keys(quotedMsg)[0]
                if (quotedType === 'imageMessage') quotedMimetype = quotedMsg.imageMessage.mimetype
                else if (quotedType === 'videoMessage') quotedMimetype = quotedMsg.videoMessage.mimetype
                else if (quotedType === 'audioMessage') quotedMimetype = quotedMsg.audioMessage.mimetype
                else if (quotedType === 'documentMessage') quotedMimetype = quotedMsg.documentMessage.mimetype
                else if (quotedType === 'stickerMessage') quotedMimetype = quotedMsg.stickerMessage.mimetype
            }
        }

        /** Reset limit harian jika tanggal WIB berubah **/
        usersDb.checkAndResetLimit(sender, isOwner, isPremium)

        /** Fungsi dikonsumsi plugin saat command berhasil — hanya kurangi sekali **/
        let limitConsumed = false
        const useLimit = () => {
            if (!limitConsumed) {
                usersDb.decrementLimit(sender)
                limitConsumed = true
            }
        }

        const LIMIT_MSG = `❌ Limit harian kamu sudah habis. limit akan direset setiap jam 00.00 WIB.`

        /** Dispatch passive onMessage hooks (eg. AFK), tanpa memotong flow command **/
        for (const plugin of plugins.values()) {
            if (typeof plugin.onMessage === 'function') {
                try {
                    Promise.resolve(plugin.onMessage({
                        sock,
                        msg,
                        body,
                        rawMessage,
                        type,
                        config,
                        usersDb,
                        groupsDb,
                        user,
                        isOwner,
                        isPremium,
                        isGroup,
                        isAdmin,
                        isBotAdmin,
                        sender,
                        botJid,
                        pushName,
                        mimetype,
                        isQuoted,
                        quotedMsg,
                        quotedType,
                        quotedMimetype,
                        contextInfo,
                        groupMetadata,
                        getGroupMetadata,
                        react,
                        useLimit
                    })).catch((err) => {
                        logger.warn(`onMessage ${plugin.name || 'plugin'}: ${err.message}`)
                    })
                } catch (err) {
                    logger.warn(`onMessage ${plugin.name || 'plugin'}: ${err.message}`)
                }
            }
        }

        if (!body) return

        /** Dispatch noPrefix plugins (mis. eval) — sebelum cek prefix **/
        for (const plugin of plugins.values()) {
            if (plugin.noPrefix && plugin.match && plugin.match(body)) {
                if (isAccessRestricted) {
                    return sendContextRestrictionMessage()
                }
                if (!sock.public && !isOwner) return
                if (plugin.ownerOnly && !isOwner) {
                    if (plugin.silentUnauthorized) return
                    return sock.sendMessage(msg.key.remoteJid, {
                        text: '❌ Command ini hanya bisa digunakan oleh owner bot.'
                    }, { quoted: msg })
                }
                if (plugin.premiumOnly && !isOwner && !isPremium) {
                    return sock.sendMessage(msg.key.remoteJid, {
                        text: '❌ Command ini hanya bisa digunakan oleh owner atau pengguna premium.'
                    }, { quoted: msg })
                }
                if (!usersDb.hasLimit(sender)) {
                    return sock.sendMessage(msg.key.remoteJid, { text: LIMIT_MSG }, { quoted: msg })
                }
                await plugin.execute({
                    sock, msg, args: [], text: body, body, config, usersDb, groupsDb, user,
                    isOwner, isPremium, isGroup, isAdmin, isBotAdmin, sender, botJid,
                    pushName, mimetype, isQuoted, quotedMsg, quotedType,
                    quotedMimetype, contextInfo, groupMetadata, getGroupMetadata, react, useLimit
                })
                return
            }
        }

        /** Check for prefixes **/
        const prefix = config.prefixes.find(p => body.startsWith(p))
        if (!prefix) {
            /** Log normal chat (non-command) if enabled **/
            if (config.logChats) {
                logger.chat(pushName || sender.split('@')[0], body, type, {
                    senderJid: sender,
                    chatJid: msg.key.remoteJid
                })
            }
            return
        }

        /** Log command execution with parsed args **/
        logger.chat(pushName || sender.split('@')[0], body, `${type} | Command`, {
            senderJid: sender,
            chatJid: msg.key.remoteJid
        })

        /** Extract command and arguments **/
        const args = body.slice(prefix.length).trim().split(/ +/)
        const cmdName = args.shift().toLowerCase()
        const text = args.join(' ')

        if (isAccessRestricted) {
            return sendContextRestrictionMessage()
        }

        /** Find exactly matching plugin alias/name **/
        let command = null
        for (const plugin of plugins.values()) {
            if (plugin.name === cmdName || (plugin.aliases && plugin.aliases.includes(cmdName))) {
                command = plugin
                break
            }
        }

        if (command) {
            /** isOwner sudah dideklarasi di atas **/

            if (isGroup && (command.adminOnly || command.botAdmin)) {
                await ensureGroupFlags()
            }

            if (isGroup && command.groupOnly && !groupMetadata) {
                await ensureGroupMetadata()
            }

            /** If in self mode, only allow owner **/
            if (!sock.public && !isOwner) return

            /** If owner-only command, reject if not owner **/
            if (command.ownerOnly && !isOwner) {
                if (command.silentUnauthorized) return
                return sock.sendMessage(msg.key.remoteJid, {
                    text: '❌ Command ini khusus owner.'
                }, { quoted: msg })
            }

            /** Group-only guard **/
            if (command.groupOnly && !isGroup) {
                return sock.sendMessage(msg.key.remoteJid, {
                    text: '❌ Command ini khusus grup.'
                }, { quoted: msg })
            }

            /** Bot must be admin guard **/
            if (command.botAdmin && !isBotAdmin) {
                return sock.sendMessage(msg.key.remoteJid, {
                    text: '❌ Command ini hanya bisa digunakan saat bot admin.'
                }, { quoted: msg })
            }

            /** Sender must be group admin guard **/
            if (command.adminOnly && !isAdmin) {
                return sock.sendMessage(msg.key.remoteJid, {
                    text: '❌ Command ini khusus admin.'
                }, { quoted: msg })
            }

            /** Premium-only guard (owner selalu lolos) **/
            if (command.premiumOnly && !isOwner && !isPremium) {
                return sock.sendMessage(msg.key.remoteJid, {
                    text: '❌ Command ini khusus premium.'
                }, { quoted: msg })
            }

            /** Limit check **/
            if (!usersDb.hasLimit(sender)) {
                return sock.sendMessage(msg.key.remoteJid, { text: LIMIT_MSG }, { quoted: msg })
            }

            await command.execute({
                sock,
                msg,
                args,
                text,
                body,
                prefix,
                command: cmdName,
                config,
                usersDb,
                groupsDb,
                user,
                isOwner,
                isPremium,
                isGroup,
                isAdmin,
                isBotAdmin,
                sender,
                botJid,
                pushName,
                mimetype,
                isQuoted,
                quotedMsg,
                quotedType,
                quotedMimetype,
                contextInfo,
                groupMetadata,
                getGroupMetadata,
                react,
                useLimit
            })
        }
    } catch (err) {
        logger.error(`Handler Error: ${err.message}`)
        const ownerJids = (config.ownerNumbers || [])
            .map((n) => String(n || '').replace(/[^0-9]/g, ''))
            .filter(Boolean)
            .map((n) => `${n}@s.whatsapp.net`)

        if (sock && ownerJids.length) {
            const detail = util.format(err).slice(0, 12000)
            for (const ownerJid of ownerJids) {
                try {
                    await sock.sendMessage(ownerJid, {
                        text: `${detail}`,
                        contextInfo: { isForwarded: false }
                    })
                } catch {}
            }
        }
    }
}
