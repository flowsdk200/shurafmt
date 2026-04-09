import { getTargetJid } from '../../src/utils/group.js'

const clean = (value) => String(value || '').trim()

export default {
    name: 'addcoin',
    aliases: ['addcoins', 'addkoin'],
    description: 'Tambah coins user',
    ownerOnly: true,
    execute: async ({ sock, msg, text, prefix, command, usersDb, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const match = clean(text).match(/(\d+)\s*$/)

        if (!match) {
            return sock.sendMessage(jid, {
                text:
                    `❌ Cara penggunaan:\n- ${prefix + command} @user/6285226344606/reply 50\n\n` +
                    `Contoh:\n- ${prefix + command} 6285226344606 50`
            }, { quoted: msg })
        }

        const amount = Math.max(0, Number(match[1]) || 0)
        const targetText = clean(text.slice(0, text.lastIndexOf(match[0])))
        const targetJid = getTargetJid(msg, targetText)

        if (!targetJid) {
            return sock.sendMessage(jid, {
                text: '❌ @mention, reply pesan target, atau ketik nomornya.'
            }, { quoted: msg })
        }

        if (amount <= 0) {
            return sock.sendMessage(jid, {
                text: '❌ Jumlah coins harus lebih dari 0.'
            }, { quoted: msg })
        }

        await react('⏳')
        const updated = usersDb.addCoins(targetJid, amount)
        useLimit()
        await react('✅')

        return sock.sendMessage(jid, {
            text: `✅ Coins @${targetJid.split('@')[0]} ditambah ${amount}. sekarang: ${updated.coins}`,
            mentions: [targetJid]
        }, { quoted: msg })
    }
}
