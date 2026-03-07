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
        const product = (
            targetFromContext
                ? rawText.replace(/^@\S+\s*/, '')
                : args.slice(1).join(' ')
        ).trim()

        if (!targetJid || !product) {
            return sock.sendMessage(jid, {
                text: 'Gunakan dengan cara tag/reply pesan user + nama produk.\n\nContoh penggunaan:\n- .proses @shura script bot'
            }, { quoted: msg })
        }

        groupsDb.setStoreOrder(jid, targetJid, product)
        useLimit()

        const now = new Date()
        const detail =
            `${row('Produk', product)}\n` +
            `${row('Pemesan', `@${targetJid.split('@')[0]}`)}\n` +
            `${row('Tanggal', formatTanggal(now))}\n` +
            `${row('Waktu', formatWaktu(now))}`
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
