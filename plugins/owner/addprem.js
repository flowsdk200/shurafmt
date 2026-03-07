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
    name: 'addprem',
    aliases: ['addpremium', 'addp', 'ap'],
    description: 'Tambah premium user dengan durasi',
    ownerOnly: true,
    execute: async ({ sock, msg, text, prefix, command, usersDb, react, useLimit }) => {
        const jid = msg.key.remoteJid

        const durationMatch = text.match(DURATION_REGEX)
        if (!durationMatch) {
            return sock.sendMessage(jid, {
                text: `Cara penggunaan:\n- ${prefix + command} @user/nomor/reply <durasi>\n\nContoh:\n${prefix + command} 6285226345606 7day\n${prefix + command} 6285226344606 30day`
            }, { quoted: msg })
        }

        /** Pisahkan target dan durasi — durasi selalu di akhir **/
        const targetText = text.slice(0, text.lastIndexOf(durationMatch[0])).trim()
        const targetJid = getTargetJid(msg, targetText)

        if (!targetJid) {
            return sock.sendMessage(jid, {
                text: '❌ @mention, reply pesan target, atau ketik nomornya.'
            }, { quoted: msg })
        }

        await react('⏳')

        const amount = parseInt(durationMatch[1])
        const unit = durationMatch[2]
        const expiry = calcExpiry(amount, unit)

        const targetUser = usersDb.getUser(targetJid)
        const targetNum = targetJid.split('@')[0]

        usersDb.setPremium(targetJid, expiry)
        useLimit()
        await react('✅')

        const expiryStr = expiry.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
        return sock.sendMessage(jid, {
            text: `✅ @${targetNum} berhasil dijadikan premium sampai ${expiryStr}`,
            mentions: [targetJid]
        }, { quoted: msg })
    }
}
