import { buildResultText, buildUsage, parseExpression } from './_math.js'

export default {
    name: 'kurang',
    aliases: ['minus'],
    description: 'Hitung pengurangan cepat',
    execute: async ({ sock, msg, text, prefix, command }) => {
        const jid = msg.key.remoteJid
        const values = parseExpression(text, ['-'])

        if (values.length < 2) {
            return sock.sendMessage(jid, {
                text: buildUsage(prefix, command, '100 - 25')
            }, { quoted: msg })
        }

        const [first, ...rest] = values
        const result = rest.reduce((total, num) => total - num, first)

        return sock.sendMessage(jid, {
            text: buildResultText({
                title: '➖ HASIL KURANG',
                symbol: '-',
                values,
                result
            })
        }, { quoted: msg })
    }
}
