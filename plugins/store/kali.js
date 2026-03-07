import { buildResultText, buildUsage, parseExpression } from './_math.js'

export default {
    name: 'kali',
    aliases: ['x'],
    description: 'Hitung perkalian cepat',
    execute: async ({ sock, msg, text, prefix, command }) => {
        const jid = msg.key.remoteJid
        const values = parseExpression(text, ['x', 'X', '×', '*'])

        if (values.length < 2) {
            return sock.sendMessage(jid, {
                text: buildUsage(prefix, command, '50 x 2')
            }, { quoted: msg })
        }

        const result = values.reduce((total, num) => total * num, 1)

        return sock.sendMessage(jid, {
            text: buildResultText({
                title: '✖️ HASIL KALI',
                symbol: '×',
                values,
                result
            })
        }, { quoted: msg })
    }
}
