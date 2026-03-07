import { buildResultText, buildUsage, parseExpression } from './_math.js'

export default {
    name: 'bagi',
    aliases: ['divide'],
    description: 'Hitung pembagian cepat',
    execute: async ({ sock, msg, text, prefix, command }) => {
        const jid = msg.key.remoteJid
        const values = parseExpression(text, ['/'])

        if (values.length < 2) {
            return sock.sendMessage(jid, {
                text: buildUsage(prefix, command, '100 / 2')
            }, { quoted: msg })
        }

        const divisors = values.slice(1)
        if (divisors.some((num) => num === 0)) {
            return sock.sendMessage(jid, {
                text: '❌ Pembagian dengan angka 0 tidak diperbolehkan.'
            }, { quoted: msg })
        }

        const [first, ...rest] = values
        const result = rest.reduce((total, num) => total / num, first)

        return sock.sendMessage(jid, {
            text: buildResultText({
                title: '➗ HASIL BAGI',
                symbol: '÷',
                values,
                result
            })
        }, { quoted: msg })
    }
}
