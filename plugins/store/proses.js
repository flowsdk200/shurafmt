import { getTargetJid } from '../../src/utils/group.js'

const formatTanggal = (date = new Date()) => date.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta'
})

const formatWaktu = (date = new Date()) => `${date.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Jakarta'
})} WIB`

const row = (label, value) => ` • ${label.padEnd(7, ' ')} : ${value}`

const formatRupiah = (value) => `Rp${new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
}).format(Number(value) || 0)}`

const parsePrice = (value = '') => {
    const cleaned = String(value || '').replace(/[^0-9]/g, '')
    if (!cleaned) return null
    const num = Number(cleaned)
    return Number.isFinite(num) && num > 0 ? num : null
}

const parseOrderInput = (raw = '') => {
    const input = String(raw || '').trim()
    if (!input) return { product: '', price: null }

    if (input.includes('|')) {
        const [productPart, pricePart] = input.split('|')
        return {
            product: String(productPart || '').trim(),
            price: parsePrice(pricePart)
        }
    }

    if (input.includes(',')) {
        const lastComma = input.lastIndexOf(',')
        const productPart = input.slice(0, lastComma).trim()
        const pricePart = input.slice(lastComma + 1).trim()
        const price = parsePrice(pricePart)
        if (productPart && price !== null) return { product: productPart, price }
    }

    const tailMatch = input.match(/^(.*?)(?:\s+)([\d.]+)$/)
    if (tailMatch) {
        const productPart = String(tailMatch[1] || '').trim()
        const price = parsePrice(tailMatch[2])
        if (productPart && price !== null) return { product: productPart, price }
    }

    return { product: input, price: null }
}

export default {
    name: 'proses',
    aliases: ['p'],
    description: 'Tandai transaksi sedang diproses',
    groupOnly: true,
    execute: async ({ sock, msg, args, text, isAdmin, isOwner, groupsDb, useLimit }) => {
        const jid = msg.key.remoteJid

        if (!isAdmin && !isOwner) {
            return sock.sendMessage(jid, {
                text: '❌ Command ini khusus admin atau owner.'
            }, { quoted: msg })
        }

        const targetJid = getTargetJid(msg, args[0] || '')
        const targetFromContext = getTargetJid(msg, '')
        const rawText = String(text || '').trim()
        const rawOrderText = (
            targetFromContext
                ? rawText.replace(/^@\S+\s*/, '')
                : args.slice(1).join(' ')
        ).trim()
        const { product, price } = parseOrderInput(rawOrderText)

        if (!targetJid || !product) {
            return sock.sendMessage(jid, {
                text:
                    'Cara penggunaan:\n' +
                    '- .proses @user canva pro\n' +
                    '- .proses @user canva pro, 35000\n' +
                    '- .proses @user canva pro|35000\n\n' +
                    'Tag/reply pesan user lalu ketik .proses canva pro'
            }, { quoted: msg })
        }

        groupsDb.setStoreOrder(jid, targetJid, product, price)
        useLimit()

        const now = new Date()
        const detailRows = [
            row('Produk', product),
            ...(price !== null ? [row('Harga', formatRupiah(price))] : []),
            row('Pemesan', `@${targetJid.split('@')[0]}`),
            row('Tanggal', formatTanggal(now)),
            row('Waktu', formatWaktu(now))
        ]
        const detail = detailRows.join('\n')
        return sock.sendMessage(jid, {
            text:
                `⏳ TRANSAKSI SEDANG PROSES\n\n` +
                `  \`DETAIL ORDER:\`\n` +
                `\`\`\`${detail}\`\`\`\n\n` +
                `pesanan anda sedang dalam proses. mohon menunggu notifikasi selanjutnya.`,
            mentions: [targetJid]
        }, { quoted: msg })
    }
}
