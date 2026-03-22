import { buildSingleResultText, buildUsage, formatNumber } from './_math.js'

const parseDiskon = (text = '') => {
    const match = String(text || '').trim().match(/^([\d.,]+)\s*-\s*([\d.,]+)%$/i)
    if (!match) return null

    const price = Number.parseFloat(match[1].replace(/\./g, '').replace(',', '.'))
    const discount = Number.parseFloat(match[2].replace(/\./g, '').replace(',', '.'))
    if (!Number.isFinite(price) || !Number.isFinite(discount)) return null

    const discountValue = (discount / 100) * price
    return {
        price,
        discount,
        discountValue,
        result: price - discountValue
    }
}

export default {
    name: 'diskon',
    aliases: ['disc'],
    description: 'Hitung harga setelah diskon',
    execute: async ({ sock, msg, text, prefix, command }) => {
        const jid = msg.key.remoteJid
        const parsed = parseDiskon(text)

        if (!parsed) {
            return sock.sendMessage(jid, {
                text: buildUsage(prefix, command, '100000 - 20%')
            }, { quoted: msg })
        }

        return sock.sendMessage(jid, {
            text: buildSingleResultText({
                title: '🏷️ HASIL DISKON',
                rows: [
                    ` • Harga  : ${formatNumber(parsed.price)}`,
                    ` • Diskon : ${formatNumber(parsed.discount)}%`,
                    ` • Potong : ${formatNumber(parsed.discountValue)}`,
                    ` • Total  : ${formatNumber(parsed.result)}`
                ]
            })
        }, { quoted: msg })
    }
}
