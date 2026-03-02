import { ZAi } from '../../scrape/zai.js'

const zai = new ZAi()

const SYSTEM_PROMPT = `Lu adalah konverter kode JavaScript ke ESModule (ESM) yang ahli dan presisi.

TUGAS:
- Konversi kode CommonJS (CJS) yang diberikan user menjadi ESModule (ESM) yang valid dan bersih.

ATURAN KONVERSI:
- require('x') → import x from 'x' (default import)
- require('x').y / const { y } = require('x') → import { y } from 'x' (named import)
- const x = require('x') → import x from 'x'
- module.exports = x → export default x
- module.exports = { a, b } → export { a, b } atau export default { a, b } jika objek literal
- module.exports.x = y → export const x = y atau export { y as x }
- exports.x = y → export const x = y
- __dirname → import { fileURLToPath } from 'url'; import { dirname } from 'path'; const __filename = fileURLToPath(import.meta.url); const __dirname = dirname(__filename);
- __filename → import { fileURLToPath } from 'url'; const __filename = fileURLToPath(import.meta.url);
- require() dinamis/kondisional → import() dinamis (async)
- Hapus "use strict" jika ada (ESM sudah strict by default)
- Tambahkan .js extension di semua import lokal jika belum ada

PENANGANAN SNIPPET:
- Jika kode tidak punya require/module.exports/import/export (snippet biasa seperti switch, function, class), tetap proses — rewrite agar kompatibel gaya ESM (misalnya async/await, named export jika relevan) dan kembalikan kode yang bersih
- Jangan tolak snippet hanya karena tidak ada module syntax

OUTPUT:
- Langsung tulis kode hasil konversi tanpa penjelasan panjang
- Tambahkan komentar singkat di atas jika ada hal penting yang perlu diperhatikan
- Jika kode sudah ESM sempurna, balas: "Kode ini sudah ESM, tidak perlu dikonversi."
- Jika input bukan kode JavaScript sama sekali, balas: "Input bukan kode JavaScript yang valid."
- Dilarang markdown seperti \`\`\`javascript atau fence block — output kode mentah saja`

export default {
    name: 'toesm',
    aliases: ['cjs2esm', 'esm'],
    description: 'Konversi kode CJS ke ESModule menggunakan AI',
    execute: async ({ sock, msg, text, isQuoted, quotedMsg, quotedType, react, useLimit }) => {
        const jid = msg.key.remoteJid

        // Ambil kode dari teks langsung atau dari quoted message
        let code = text?.trim()
        if (!code && isQuoted && quotedMsg) {
            if (quotedType === 'conversation') code = quotedMsg.conversation?.trim()
            else if (quotedType === 'extendedTextMessage') code = quotedMsg.extendedTextMessage?.text?.trim()
        }

        if (!code) {
            return sock.sendMessage(jid, {
                text: `❌ Kirim/reply kode CJS yang ingin dikonversi.`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const result = await zai.chat({
                model: 'glm-5',
                stream: false,
                max_tokens: 25000,
                temperature: 0.2,
                top_p: 0.9,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: code }
                ]
            })

            const reply = result?.choices?.[0]?.message?.content?.trim()
            if (!reply) {
                await react('❌')
                return sock.sendMessage(jid, { text: '❌ AI tidak memberikan respons. Coba lagi nanti.' }, { quoted: msg })
            }

            useLimit()
            await react('✅')
            await sock.sendMessage(jid, { text: reply }, { quoted: msg })
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, { text: `❌ Gagal: ${err.message}` }, { quoted: msg })
        }
    }
}
