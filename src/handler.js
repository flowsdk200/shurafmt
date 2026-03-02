import fs from 'fs'
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

const messageIdCache = new NodeCache({ stdTTL: 5 * 60, useClones: false })
const antispamCache = new NodeCache({ stdTTL: 15, useClones: false })
const antispamWarnCache = new NodeCache({ stdTTL: 5, useClones: false })
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginsDir = path.join(__dirname, '../plugins')

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
                    const meta = sock._groupCache?.get(msg.key.remoteJid) || await sock.groupMetadata(msg.key.remoteJid)
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
            const paramsJson = resp?.nativeFlowResponseMessage?.paramsJson
            if (paramsJson) {
                try {
                    const parsed = JSON.parse(paramsJson)
                    body = parsed.id || parsed.selectedId || parsed.display_text || ''
                } catch { body = '' }
            }
            if (!body) body = resp?.selectedButtonId || ''
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

        const getGroupMetadata = async (jid) => {
            try {
                const meta = await sock.groupMetadata(jid)

                /** SuraBails punya TODO resmi di groups.js:315 — tidak otomatis simpan
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
        if (isGroup) {
            groupMetadata = await getGroupMetadata(msg.key.remoteJid)
            if (groupMetadata) {
                /** Normalize participant IDs: @lid → @s.whatsapp.net sebelum dibandingkan.
                 *  Fallback ke p.phoneNumber jika normalizeJid masih return @lid
                 *  (terjadi saat LID mapping belum tersimpan di file auth state). **/
                const admins = groupMetadata.participants
                    .filter(p => p.admin)
                    .map(p => {
                        const normalized = normalizeJid(p.id)
                        if (normalized && !normalized.endsWith('@lid')) return normalized
                        if (p.phoneNumber) return normalizeJid(p.phoneNumber) || p.phoneNumber
                        return normalized
                    })
                    .filter(Boolean)
                isAdmin = admins.includes(sender)
                isBotAdmin = admins.includes(botJid)
            }

            // Persist group info for future group features.
            groupsDb.recordMessage(
                msg.key.remoteJid,
                groupMetadata?.subject || '',
                groupMetadata
            )
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

        const LIMIT_MSG = `❌ Limit harian kamu sudah habis.\nLimit akan direset setiap jam 00.00 WIB.\n\nLimit harian:\n▦ Free: ${config.limits.free}\n▦ Premium: ${config.limits.premium.toLocaleString('id-ID')}\n▦ Owner: ${config.limits.owner.toLocaleString('id-ID')}`

        if (!body) return

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

        /** Dispatch noPrefix plugins (mis. eval) — sebelum cek prefix **/
        for (const plugin of plugins.values()) {
            if (plugin.noPrefix && plugin.match && plugin.match(body)) {
                if (!sock.public && !isOwner) return
                if (plugin.ownerOnly && !isOwner) {
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

            /** If in self mode, only allow owner **/
            if (!sock.public && !isOwner) return

            /** If owner-only command, reject if not owner **/
            if (command.ownerOnly && !isOwner) {
                return sock.sendMessage(msg.key.remoteJid, {
                    text: '❌ Command ini hanya bisa digunakan oleh owner bot.'
                }, { quoted: msg })
            }

            /** Group-only guard **/
            if (command.groupOnly && !isGroup) {
                return sock.sendMessage(msg.key.remoteJid, {
                    text: '❌ Command ini hanya bisa digunakan di dalam grup.'
                }, { quoted: msg })
            }

            /** Bot must be admin guard **/
            if (command.botAdmin && !isBotAdmin) {
                return sock.sendMessage(msg.key.remoteJid, {
                    text: '❌ Bot harus menjadi admin grup terlebih dahulu.'
                }, { quoted: msg })
            }

            /** Sender must be group admin or owner guard **/
            if (command.adminOnly && !isAdmin && !isOwner) {
                return sock.sendMessage(msg.key.remoteJid, {
                    text: '❌ Hanya admin grup atau owner yang bisa menggunakan command ini.'
                }, { quoted: msg })
            }

            /** Premium-only guard (owner selalu lolos) **/
            if (command.premiumOnly && !isOwner && !isPremium) {
                return sock.sendMessage(msg.key.remoteJid, {
                    text: '❌ Command ini hanya bisa digunakan oleh owner atau pengguna premium.'
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
