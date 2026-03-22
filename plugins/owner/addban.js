import { getTargetJid } from '../../src/utils/group.js'

const DURATION_REGEX = /(\d+)\s*(h|hour|hours|d|day|days|w|week|weeks|m|month|months)$/i

function calcExpiry(amount, unit) {
    const u = unit.toLowerCase()
    const now = new Date()
    if (u.startsWith('h')) now.setHours(now.getHours() + amount)
    else if (u.startsWith('d')) now.setDate(now.getDate() + amount)
    else if (u.startsWith('w')) now.setDate(now.getDate() + amount * 7)
    else if (u.startsWith('m')) now.setMonth(now.getMonth() + amount)
    return now
}

export default {
    name: 'addban',
    aliases: ['ban'],
    description: 'Ban user dengan durasi',
    ownerOnly: true,
    execute: async ({ sock, msg, text, prefix, command, usersDb, config, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const durationMatch = text.match(DURATION_REGEX)

        if (!durationMatch) {
            return sock.sendMessage(jid, {
                text: `Cara penggunaan:\n- ${prefix + command} @user/nomor/reply <durasi>\n\nContoh:\n${prefix + command} 6285226344606 7d\n${prefix + command} 6285226344606 30d\n${prefix + command} 6285226344606 120d`
            }, { quoted: msg })
        }

        const targetText = text.slice(0, text.lastIndexOf(durationMatch[0])).trim()
        const targetJid = getTargetJid(msg, targetText)

        if (!targetJid) {
            return sock.sendMessage(jid, {
                text: '❌ @mention, reply pesan target, atau ketik nomornya.'
            }, { quoted: msg })
        }

        const targetNum = targetJid.split('@')[0]
        const isTargetOwner = config.ownerNumbers.includes(targetNum) || usersDb.isOwner(targetJid)
        if (isTargetOwner) {
            return sock.sendMessage(jid, {
                text: '❌ Tidak bisa ban owner bot.'
            }, { quoted: msg })
        }

        await react('⏳')

        const amount = parseInt(durationMatch[1], 10)
        const unit = durationMatch[2]
        const expiry = calcExpiry(amount, unit)
        const targetUser = usersDb.getUser(targetJid)
        const targetName = targetUser.name || targetNum

        usersDb.ban(targetJid, expiry)
        useLimit()
        await react('✅')

        const expiryStr = expiry.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
        return sock.sendMessage(jid, {
            text: `✅ @${targetNum} berhasil diban sampai ${expiryStr}.`,
            mentions: [targetJid]
        }, { quoted: msg })
    }
}
