import afkDb from '../../src/database/afk.js'
import { normalizeJid } from '../../src/utils/jid.js'

const DEFAULT_REASON = 'gak ada alasan'

const formatTime = (value, withSeconds = false) => {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return '-'

    const fmt = new Intl.DateTimeFormat('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        ...(withSeconds ? { second: '2-digit' } : {}),
        hour12: false,
        timeZone: 'Asia/Jakarta'
    }).format(d)

    const [datePart = '', timePart = ''] = String(fmt).split(',')
    return `${datePart.replace('.', '').trim()}, ${timePart.trim().replace(':', '.')}`
}

const formatDuration = (ms = 0) => {
    const total = Math.max(0, Math.floor(Number(ms || 0) / 1000))
    const days = Math.floor(total / 86400)
    const hours = Math.floor((total % 86400) / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    const seconds = total % 60

    if (days > 0) return `${days} hari, ${hours} jam, ${minutes} menit`
    if (hours > 0) return `${hours} jam, ${minutes} menit, ${seconds} detik`
    if (minutes > 0) return `${minutes} menit, ${seconds} detik`
    return `0 menit, ${seconds} detik`
}

const normalizeText = (value = '', fallback = '') => {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    return text || fallback
}

const userKey = (jid = '') => String(normalizeJid(jid) || jid || '').split('@')[0].split(':')[0]

const canonicalJid = (jid = '') => {
    const raw = String(normalizeJid(jid) || jid || '').trim()
    if (!raw) return ''
    const parts = raw.split('@')
    const user = (parts[0] || '').split(':')[0]
    const server = parts[1] || 's.whatsapp.net'
    if (!user) return ''
    return `${user}@${server}`
}
const isAfkCommand = (body = '', prefixes = []) => {
    const text = String(body || '').trim().toLowerCase()
    if (!text) return false
    return prefixes.some((p) => {
        const pref = String(p || '').toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const re = new RegExp(`^${pref}afk(?:\\s|$)`)
        return re.test(text)
    })
}

const getTargetKeys = (contextInfo, sender, isQuoted, groupMetadata) => {
    const senderKey = userKey(sender)
    const keys = new Set()
    const participants = Array.isArray(groupMetadata?.participants) ? groupMetadata.participants : []

    const addCandidate = (jid) => {
        if (!jid) return
        const raw = String(jid).trim()
        if (!raw) return

        const rawKey = raw.split('@')[0].split(':')[0]
        const normalizedKey = userKey(raw)

        if (rawKey && rawKey !== senderKey) keys.add(rawKey)
        if (normalizedKey && normalizedKey !== senderKey) keys.add(normalizedKey)

        for (const p of participants) {
            const idKey = userKey(p?.id)
            const phoneKey = userKey(p?.phoneNumber)
            const hit =
                (rawKey && (idKey === rawKey || phoneKey === rawKey)) ||
                (normalizedKey && (idKey === normalizedKey || phoneKey === normalizedKey))

            if (hit) {
                if (idKey && idKey !== senderKey) keys.add(idKey)
                if (phoneKey && phoneKey !== senderKey) keys.add(phoneKey)
            }
        }
    }

    const mentions = Array.isArray(contextInfo?.mentionedJid) ? contextInfo.mentionedJid : []
    for (const jid of mentions) addCandidate(jid)

    const quoted = isQuoted ? contextInfo?.participant : null
    addCandidate(quoted)

    return [...keys]
}

export default {
    name: 'afk',
    aliases: [],
    description: 'Set status AFK',
    groupOnly: true,

    execute: async ({ sock, msg, text, sender, pushName, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const senderId = canonicalJid(sender)
        if (!senderId) return
        const rawReason = normalizeText(text)
        const reason = rawReason.length > 0 ? rawReason : DEFAULT_REASON
        const startAt = new Date()

        await react('⏳')

        try {
            await afkDb.setAfk({
                userId: senderId,
                groupId: jid,
                username: String(pushName || senderId.split('@')[0]),
                reason,
                startAt
            })

            useLimit()
            await react('✅')

            const lines = [
                `✅ @${senderId.split('@')[0]} sekarang AFK\n`,
                `× Alasan: ${reason}`,
                `× Waktu: ${formatTime(startAt, true)}`
            ]

            await sock.sendMessage(jid, {
                text: lines.join('\n'),
                mentions: [senderId]
            }, { quoted: msg })
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Gagal set AFK: ${err.message}`
            }, { quoted: msg })
        }
    },

    onMessage: async ({ sock, msg, isGroup, sender, body, config, contextInfo, groupMetadata, isQuoted, rawMessage, type }) => {
        if (!isGroup) return

        const jid = msg.key.remoteJid
        const senderId = canonicalJid(sender)
        if (!senderId) return
        const now = Date.now()
        const fallbackContextInfo = rawMessage?.[type]?.contextInfo || rawMessage?.extendedTextMessage?.contextInfo || null
        const effectiveContextInfo = contextInfo || fallbackContextInfo

        try {
            const selfAfk = await afkDb.getAfk(senderId, jid, { startAt: 1 })
            if (selfAfk && !isAfkCommand(body, config.prefixes || [])) {
                await afkDb.clearAfk(senderId, jid)
                await sock.sendMessage(jid, {
                    text:
                        `🎉 @${senderId.split('@')[0]} telah kembali dari AFK\n\n` +
                        `× Total AFK: ${formatDuration(now - new Date(selfAfk.startAt).getTime())}\n` +
                        `× Kembali: ${formatTime(now, true)}`,
                    mentions: [senderId]
                }, { quoted: msg })
            }
        } catch {}

        const targetKeys = getTargetKeys(effectiveContextInfo, senderId, isQuoted, groupMetadata)
        if (!targetKeys.length) return

        const targets = [...new Set(targetKeys.flatMap((k) => [`${k}@s.whatsapp.net`, `${k}@lid`]))]

        try {
            const participants = Array.isArray(groupMetadata?.participants) ? groupMetadata.participants : null
            const hasMemberSnapshot = Array.isArray(participants) && participants.length > 0
            const members = hasMemberSnapshot
                ? new Set(
                    participants
                        .flatMap((p) => [userKey(p.id), userKey(p.phoneNumber)])
                        .filter(Boolean)
                )
                : null

            const records = await afkDb.getMany(
                jid,
                targets,
                { userId: 1, groupId: 1, reason: 1, startAt: 1, notifyCooldown: 1 }
            )
            if (!records.length) return

            const lines = []
            const mentions = []
            const stale = []
            let cooldownBlocked = 0

            for (const rec of records) {
                if (hasMemberSnapshot && !members.has(userKey(rec.userId))) {
                    stale.push(rec.userId)
                    continue
                }

                const allowed = await afkDb.tryMarkNotified(rec, now)
                if (!allowed) {
                    cooldownBlocked += 1
                    continue
                }

                lines.push(
                    `⚠️ Jangan tag @${rec.userId.split('@')[0]} dia sedang AFK\n\n` +
                    `× Alasan: ${normalizeText(rec.reason, DEFAULT_REASON)}\n` +
                    `× Durasi AFK: ${formatDuration(now - new Date(rec.startAt).getTime())}\n` +
                    `× Sejak: ${formatTime(rec.startAt, true)}`
                )
                mentions.push(rec.userId)
            }

            if (stale.length) await afkDb.clearMany(jid, stale)
            if (!lines.length) return

            await sock.sendMessage(jid, {
                text: lines.join('\n\n'),
                mentions: [...new Set(mentions)]
            }, { quoted: msg })
        } catch {}
    }
}
