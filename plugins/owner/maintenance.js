import config from '../../config.js'
import { getTargetJid } from '../../src/utils/group.js'

const OWNER_TAG = '@riflowsxz'

const formatWibTime = () => {
    const parts = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).formatToParts(new Date())

    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]))
    const day = map.day || ''
    const month = map.month || ''
    const year = map.year || ''
    const hour = map.hour || '00'
    const minute = map.minute || '00'

    return `${day} ${month} ${year}, ${hour}.${minute} WIB`
}

const normalizeNumberToJid = (raw = '') => {
    const candidates = String(raw)
        .split('/')
        .map((s) => s.trim())
        .filter(Boolean)

    for (const candidate of candidates) {
        const digits = candidate.replace(/[^0-9]/g, '')
        if (digits.length >= 7) return `${digits}@s.whatsapp.net`
    }

    const fallbackDigits = String(raw).replace(/[^0-9]/g, '')
    if (fallbackDigits.length >= 7) return `${fallbackDigits}@s.whatsapp.net`
    return ''
}

const extractTargetAndCustomText = (raw = '') => {
    const tokens = String(raw).trim().split(/\s+/).filter(Boolean)
    if (!tokens.length) return { targetExpr: '', customText: '' }

    let cutIndex = 0
    for (let i = 0; i < tokens.length; i += 1) {
        if (!/^[0-9+()\-\/]+$/.test(tokens[i])) break
        cutIndex = i + 1
    }

    if (cutIndex === 0) {
        return {
            targetExpr: tokens[0] || '',
            customText: tokens.slice(1).join(' ').trim()
        }
    }

    return {
        targetExpr: tokens.slice(0, cutIndex).join(' ').trim(),
        customText: tokens.slice(cutIndex).join(' ').trim()
    }
}

const buildStartText = (customText) => {
    const timeText = formatWibTime()
    return `⚠️ *MAINTENANCE NOTICE*

System bot sedang maintenance.

• *Waktu: ${timeText}*
• *Kontak developer: ${OWNER_TAG}*

Detail:
- ${customText}

Mohon coba lagi setelah maintenance selesai. terima kasih.`
}

const buildDoneText = (customText) => {
    const timeText = formatWibTime()
    return `⚠️ *MAINTENANCE NOTICE*

System bot maintenance telah selesai.

• *Waktu: ${timeText}*
• *Developer: ${OWNER_TAG}*

Update:
- ${customText}
- Seluruh fitur bot sudah kembali normal.

Jika masih ada kendala, silakan laporkan ke owner ${OWNER_TAG}`
}

export default {
    name: 'maintenance',
    aliases: ['mtn'],
    description: 'Send strict maintenance start/done notice to specific target number',
    ownerOnly: true,
    execute: async ({ sock, msg, args, text, prefix, command, sender, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const subcommand = String(args?.[0] || '').toLowerCase()
        const tail = String(text || '').split(/\s+/).slice(1).join(' ').trim()
        const { targetExpr, customText } = extractTargetAndCustomText(tail)

        if (!['start', 'done'].includes(subcommand)) {
            return sock.sendMessage(jid, {
                text:
                    `Format:\n` +
                    `- ${prefix + command} start +62 821-3601-5864/6282136015864 teks kustom\n` +
                    `- ${prefix + command} done +62 821-3601-5864/6282136015864 teks kustom`
            }, { quoted: msg })
        }

        const parsedJid = normalizeNumberToJid(targetExpr)
        const targetJid = getTargetJid(msg, parsedJid || targetExpr)
        if (!targetJid) {
            return sock.sendMessage(jid, {
                text: `Target tidak valid. Contoh:\n- ${prefix + command} ${subcommand} +62 821-3601-5864/6282136015864 teks kustom`
            }, { quoted: msg })
        }

        if (!customText) {
            return sock.sendMessage(jid, {
                text: `Teks kustom wajib diisi.\nContoh:\n- ${prefix + command} ${subcommand} +62 821-3601-5864/6282136015864 Perbaikan database user sedang berlangsung.`
            }, { quoted: msg })
        }

        const ownerNumber = String(config.ownerNumbers?.[0] || '').replace(/[^0-9]/g, '')
        const ownerJid = ownerNumber ? `${ownerNumber}@s.whatsapp.net` : sender
        const mentions = ownerJid ? [ownerJid] : []
        const noticeText = subcommand === 'start' ? buildStartText(customText) : buildDoneText(customText)

        try {
            await react('⏳')
            await sock.sendMessage(targetJid, { text: noticeText, mentions })
            useLimit()
            await react('✅')
            return sock.sendMessage(jid, {
                text: `Berhasil kirim notice ${subcommand} ke @${targetJid.split('@')[0]}`,
                mentions: [targetJid]
            }, { quoted: msg })
        } catch (err) {
            await react('❌')
            return sock.sendMessage(jid, {
                text: `Gagal kirim notice: ${err.message}`
            }, { quoted: msg })
        }
    }
}
