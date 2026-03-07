import { buildSingleResultText, buildUsage, evaluateMathExpression, formatNumber } from './_math.js'

export default {
    name: 'total',
    aliases: ['jumlahtotal'],
    description: 'Hitung total dari ekspresi angka',
    execute: async ({ sock, msg, text, prefix, command }) => {
        const jid = msg.key.remoteJid
        const parsed = evaluateMathExpression(text)

        if (!parsed) {
            return sock.sendMessage(jid, {
                text: buildUsage(prefix, command, '50000 + 5000 - 2000')
            }, { quoted: msg })
        }

        const expression = parsed.tokens
            .map((token) => typeof token === 'number' ? formatNumber(token) : token.replace('*', '×'))
            .join(' ')

        return sock.sendMessage(jid, {
            text: buildSingleResultText({
                title: '🧮 HASIL TOTAL',
                rows: [
                    ` • Input : ${expression}`,
                    ` • Hasil : ${formatNumber(parsed.result)}`
                ]
            })
        }, { quoted: msg })
    }
}
