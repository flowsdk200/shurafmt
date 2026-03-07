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
    name: 'done',
    aliases: ['d'],
    description: 'Tandai transaksi berhasil',
    groupOnly: true,
    execute: async ({ sock, msg, args, isAdmin, isOwner, groupsDb, useLimit }) => {
        const jid = msg.key.remoteJid

        if (!isAdmin && !isOwner) {
            return sock.sendMessage(jid, {
                text: '❌ Command ini khusus admin atau owner.'
            }, { quoted: msg })
        }

        const targetJid = getTargetJid(msg, args[0] || '')
        if (!targetJid) {
            return sock.sendMessage(jid, {
                text: 'Gunakan dengan cara tag/reply pesan user.\n\nContoh penggunaan:\n- .done @shura'
            }, { quoted: msg })
        }

        const order = groupsDb.getStoreOrder(jid, targetJid)
        if (!order?.product) {
            return sock.sendMessage(jid, {
                text: `❌ Gak ada transaksi aktif untuk @${targetJid.split('@')[0]}.`,
                mentions: [targetJid]
            }, { quoted: msg })
        }

        groupsDb.clearStoreOrder(jid, targetJid)
        useLimit()

        const now = new Date()
        const detail =
            `${row('Produk', order.product)}\n` +
            `${row('Pemesan', `@${targetJid.split('@')[0]}`)}\n` +
            `${row('Tanggal', formatTanggal(now))}\n` +
            `${row('Waktu', formatWaktu(now))}`
        return sock.sendMessage(jid, {
            text:
                `✅ TRANSAKSI BERHASIL!\n\n` +
                `  \`RINGKASAN ORDER:\`\n` +
                `\`\`\`${detail}\`\`\`\n\n` +
                `pesanan anda telah berhasil diselesaikan. terima kasih sudah order.`,
            mentions: [targetJid]
        }, { quoted: msg })
    }
}
