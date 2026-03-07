import { buildSingleResultText, buildUsage, formatNumber } from './_math.js'

const parsePersen = (text = '') => {
    const match = String(text || '').trim().match(/^([\d.,]+)%?\s*(?:dari)?\s*([\d.,]+)$/i)
    if (!match) return null

    const percent = Number.parseFloat(match[1].replace(/\./g, '').replace(',', '.'))
    const amount = Number.parseFloat(match[2].replace(/\./g, '').replace(',', '.'))
    if (!Number.isFinite(percent) || !Number.isFinite(amount)) return null

    return {
        percent,
        amount,
        result: (percent / 100) * amount
    }
}

export default {
    name: 'persen',
    aliases: ['percent'],
    description: 'Hitung nilai persen dari angka',
    execute: async ({ sock, msg, text, prefix, command }) => {
        const jid = msg.key.remoteJid
        const parsed = parsePersen(text)

        if (!parsed) {
            return sock.sendMessage(jid, {
                text: buildUsage(prefix, command, '10% dari 50000')
            }, { quoted: msg })
        }

        return sock.sendMessage(jid, {
            text: buildSingleResultText({
                title: '📊 HASIL PERSEN',
                rows: [
                    ` • Persen : ${formatNumber(parsed.percent)}%`,
                    ` • Dari   : ${formatNumber(parsed.amount)}`,
                    ` • Hasil  : ${formatNumber(parsed.result)}`
                ]
            })
        }, { quoted: msg })
    }
}
