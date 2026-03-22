import { buildResultText, buildUsage, parseExpression } from './_math.js'

export default {
    name: 'tambah',
    aliases: ['plus'],
    description: 'Hitung penjumlahan cepat',
    execute: async ({ sock, msg, text, prefix, command }) => {
        const jid = msg.key.remoteJid
        const values = parseExpression(text, ['+'])

        if (values.length < 2) {
            return sock.sendMessage(jid, {
                text: buildUsage(prefix, command, '50 + 50')
            }, { quoted: msg })
        }

        const result = values.reduce((sum, num) => sum + num, 0)
        return sock.sendMessage(jid, {
            text: buildResultText({
                title: '➕ HASIL TAMBAH',
                symbol: '+',
                values,
                result
            })
        }, { quoted: msg })
    }
}
